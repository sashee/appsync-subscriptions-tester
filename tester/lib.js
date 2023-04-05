import {Observable, Subscription, EMPTY, of} from "rxjs";
import {randomUUID} from "crypto";
import {webSocket} from "rxjs/webSocket";
import {filter, shareReplay, debounceTime, startWith, share, take, timeout, retry, map} from "rxjs/operators";

const exponentialBackoffWithJitter = (base, cap, retryCount) => {
	const max = Math.min(base ** retryCount, cap);
	return (Math.random() * (max - base)) + base;
}

export const appsyncRealtime = ({APIURL, connectionRetryConfig = {}, WebSocketCtor}) => {
	// https://github.com/aws-amplify/amplify-js/blob/4988d51a6ffa1215a413c19c80f39a035eb42512/packages/pubsub/src/Providers/AWSAppSyncRealTimeProvider/index.ts#L70
	const standardDomainPattern = /^https:\/\/\w{26}\.appsync-api\.\w{2}(?:(?:-\w{2,})+)-\d\.amazonaws.com\/graphql$/i;
	const realtimeUrl = APIURL.match(standardDomainPattern) ?
		APIURL.replace("appsync-api", "appsync-realtime-api").replace("gogi-beta", "grt-beta") :
		APIURL + "/realtime";

	let lastGetAuthorizationHeaders;

	const websockets = new Observable((observer) => {
		const subscription = new Subscription();
		Promise.resolve(lastGetAuthorizationHeaders({connect: true, data: {}})).then((authHeaders) => {
			if(!subscription.closed) {
				const ws = webSocket({
					url: `wss://${new URL(realtimeUrl).host}${new URL(realtimeUrl).pathname}?header=${Buffer.from(JSON.stringify(authHeaders), "utf8").toString("base64")}&payload=${Buffer.from(JSON.stringify({}), "utf8").toString("base64")}`,
					protocol: "graphql-ws",
					WebSocketCtor: WebSocketCtor ?? WebSocket,
					openObserver: ({next: () => {
						ws.next({type: "connection_init"});
					}}),
				});
				subscription.add(ws.pipe(
					filter(({type, id}) => type === "error" && !id),
				).subscribe({
					next: ({payload}) => observer.error(payload),
					error: (e) => observer.error(e),
					complete: () => observer.complete(),
				}));
				subscription.add(ws.pipe(
					filter(({type}) => type === "connection_ack"),
					take(1),
				).subscribe({
					next: ({payload: {connectionTimeoutMs}}) => {
						subscription.add(ws
							.pipe(
								filter(({type}) => type === "ka"),
								startWith(undefined),
								debounceTime(connectionTimeoutMs),
							).subscribe(() => observer.complete()));
						observer.next(ws);
					},
					error: (e) => observer.error(e),
				}));
			}
		}, (e) => observer.error(e));
		return () => {
			subscription.unsubscribe();
		};
	}).pipe(
		shareReplay({refCount: true}),
	);

	const appSyncWebSocket = (getAuthorizationHeaders, opened, subscriptionRetryConfig = {}) => (query, variables) => new Observable((observer) => {
		lastGetAuthorizationHeaders = getAuthorizationHeaders;
		const subscriptionId = randomUUID();
		const subscription = websockets.pipe(
			timeout({first: connectionRetryConfig.timeout ?? 5000}),
			retry((connectionRetryConfig.maxAttempts ?? 5) - 1, (_e, retryCount) => exponentialBackoffWithJitter(connectionRetryConfig.base ?? 10, connectionRetryConfig.cap ?? 2000, retryCount)),
		).subscribe({
			next: (ws) => {
				Promise.resolve(getAuthorizationHeaders({connect: false, data: {query, variables}})).then((authHeaders) => {
					const wsSubscription = ws.multiplex(
						() => ({
							id: subscriptionId,
							type: "start",
							payload: {
								data: JSON.stringify({query, variables}),
								extensions: {
									authorization: authHeaders,
								}
							}
						}),
						() => ({
							id: subscriptionId,
							type: "stop",
						}),
						({id}) => id === subscriptionId,
					).pipe(
						map((msg) => {
							if (msg.type === "error") {
								throw msg.payload;
							}else {
								return msg;
							}
						}),
						share(),
					);
					const startAckSubscription = wsSubscription.pipe(
						filter(({type}) => type === "start_ack"),
						timeout({first: subscriptionRetryConfig.timeout ?? 5000}),
						retry((subscriptionRetryConfig.maxAttempts ?? 5) - 1, (_e, retryCount) => exponentialBackoffWithJitter(subscriptionRetryConfig.base ?? 10, subscriptionRetryConfig.cap ?? 2000, retryCount)),
					).subscribe({
						next: () => {
							opened?.();
							if(!subscription.closed) {
								subscription.add(wsSubscription.pipe(
									filter(({type}) => type === "data"),
								).subscribe(({
									next: (({payload}) => observer.next(payload)),
									error: (e) => observer.error(e),
								})));
								subscription.add(wsSubscription.pipe(
									filter(({type}) => type === "complete")
								).subscribe(({
									next: (() => observer.complete()),
									error: (e) => observer.error(e),
									complete: () => observer.complete(),
								})));
								startAckSubscription.unsubscribe();
							}
						},
						error: (e) => observer.error(e),
						complete: () => observer.complete(),
					});
					subscription.add(startAckSubscription);
				}, (e) => observer.error(e));
			},
			error: (e) => observer.error(e),
			complete: () => observer.complete(),
		});
		return () => {
			subscription.unsubscribe();
		};
	});

	return {
		subscription: (getAuthHeaders, opened, subscriptionRetryConfig) => (query, variables) => {
			return appSyncWebSocket(getAuthHeaders, opened, subscriptionRetryConfig)(query, variables);
		},
	};
};

