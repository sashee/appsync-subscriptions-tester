import {Observable, Subscription, EMPTY, of, from, BehaviorSubject, NEVER, defer, ReplaySubject, merge, pipe} from "rxjs";
import {randomUUID} from "crypto";
import {webSocket} from "rxjs/webSocket";
import {filter, shareReplay, debounceTime, startWith, share, take, timeout, retry, map, mergeMap, tap, withLatestFrom, switchMap, first, takeUntil} from "rxjs/operators";

const exponentialBackoffWithJitter = ({base, cap, timeout: timeoutMs, maxAttempts}) => pipe(
	timeout({first: timeoutMs}),
	retry(maxAttempts - 1, (_e, retryCount) => {
		const max = Math.min(base ** retryCount, cap);
		return (Math.random() * (max - base)) + base;
	}),
);

export const appsyncRealtime = ({APIURL, connectionRetryConfig = {}, WebSocketCtor}) => {
	// https://github.com/aws-amplify/amplify-js/blob/4988d51a6ffa1215a413c19c80f39a035eb42512/packages/pubsub/src/Providers/AWSAppSyncRealTimeProvider/index.ts#L70
	const standardDomainPattern = /^https:\/\/\w{26}\.appsync-api\.\w{2}(?:(?:-\w{2,})+)-\d\.amazonaws.com\/graphql$/i;
	const realtimeUrl = APIURL.match(standardDomainPattern) ?
		APIURL.replace("appsync-api", "appsync-realtime-api").replace("gogi-beta", "grt-beta") :
		APIURL + "/realtime";

	const getAuthorizationHeadersSubject = new ReplaySubject(1);

	const websockets = defer(() =>
		NEVER.pipe(
			startWith(undefined),
			withLatestFrom(getAuthorizationHeadersSubject),
			mergeMap(([, fn]) => Promise.resolve(fn({connect: true, data: {}}))),
			(observable) => new Observable((subscriber) => {
				const subscription = observable.subscribe({
					next: (authHeaders) => {
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
							next: ({payload}) => subscriber.error(payload),
							error: (e) => subscriber.error(e),
							complete: () => subscriber.complete(),
						}));
						subscription.add(ws.pipe(
							filter(({type}) => type === "connection_ack"),
							take(1),
							tap(() => subscriber.next(ws)),
							mergeMap(({payload: {connectionTimeoutMs}}) => {
								return ws
									.pipe(
										filter(({type}) => type === "ka"),
										startWith(undefined),
										debounceTime(connectionTimeoutMs),
										tap(() => subscriber.complete()),
									);
							}),
						).subscribe({
							error: (e) => subscriber.error(e),
							complete: () => subscriber.complete(),
						}));
					},
					error: (e) => subscriber.error(e),
					complete: () => subscriber.complete(),
				});
				return () => subscription.unsubscribe();
			})
		)
	).pipe(
		shareReplay({refCount: true}),
	);

	const appSyncWebSocket = (getAuthorizationHeaders, opened, subscriptionRetryConfig = {}) => (query, variables) => new Observable((observer) => {
		getAuthorizationHeadersSubject.next(getAuthorizationHeaders);
		const subscriptionId = randomUUID();
		const subscription = websockets.pipe(
			exponentialBackoffWithJitter({base: connectionRetryConfig.base ?? 10, cap: connectionRetryConfig.cap ?? 2000, maxAttempts: connectionRetryConfig.maxAttempts ?? 5, timeout: connectionRetryConfig.timeout ?? 5000}),
			(observable) => new Observable((subscriber) => {
				const subscription = observable.subscribe({
					next: (ws) => {
						Promise.resolve(getAuthorizationHeaders({connect: false, data: {query, variables}})).then(
							(authHeaders) => subscriber.next([ws, authHeaders]),
							(e) => subscriber.error(e),
						)
					},
					error: (e) => subscriber.error(e),
					complete: () => subscriber.complete(),
				});
				return () => subscription.unsubscribe();
			}),
		).subscribe({
			next: ([ws, authHeaders]) => {
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
				subscription.add(wsSubscription.pipe(
					filter(({type}) => type === "start_ack"),
					exponentialBackoffWithJitter({base: subscriptionRetryConfig.base ?? 10, cap: subscriptionRetryConfig.cap ?? 2000, maxAttempts: subscriptionRetryConfig.maxAttempts ?? 5, timeout: subscriptionRetryConfig.timeout ?? 5000}),
					first(),
					tap(opened),
					mergeMap(() => {
						return wsSubscription.pipe(
							takeUntil(wsSubscription.pipe(
								filter(({type}) => type === "complete"),
							)),
							filter(({type}) => type === "data"),
							map(({payload}) => payload),
						)
					}),
				).subscribe(observer));
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

