import {connection, sendQuery, persistentSubscription, APIURL, APIKEY} from "./utils.mjs";
import {Observable, Subject, of, from, defer} from "rxjs";
import {tap, retry, map, count, mergeMap, mergeWith, scan, distinctUntilChanged, switchMap, repeat} from "rxjs/operators";
import htm from "htm";
import React, {useState, useEffect} from "react";

const html = htm.bind(React.createElement);

const updatesToDoor = (connection) => ({getAuthorizationHeaders, subscriptionRetryConfig, reopenTimeoutOnError, reopenTimeoutOnComplete, retryFetchDelay, subscription: {query, variables, extractItemFromSubscription}, fetchItem, extractLastUpdated, listeners}) => {
	const opened = new Subject();

	opened.subscribe(() => listeners?.opened?.());

	return persistentSubscription(connection)({getAuthorizationHeaders, subscriptionRetryConfig, opened: () => opened.next(), closed: (e) => listeners?.closed?.(e), reopenTimeoutOnError, reopenTimeoutOnComplete})(query, variables)
		.pipe(
			map((item) => extractItemFromSubscription(item)),
			mergeWith(opened.pipe(
				switchMap(() => defer(() => fetchItem())
				.pipe(
					retry({delay: retryFetchDelay ?? 5000}),
				)),
			)),
			scan((acc, value) =>
				extractLastUpdated(value) > extractLastUpdated(acc) ? value : acc
			),
			distinctUntilChanged(),
		);
};

const fetchItem = async () => {
	const query = `query MyQuery {
door {
	open
	last_updated
}
}`;
	const operationName = "MyQuery";
	const variables = {};
	const resJson = await sendQuery(query, operationName, variables);
	return resJson.data.door;
};

const updates = (listeners) => updatesToDoor(connection)({
	getAuthorizationHeaders: () => ({host: new URL(APIURL).host, "x-api-key": APIKEY}),
	subscription: {
		query: `subscription MySubscription {
  door {
    open
    last_updated
  }
}
`,
		variables: {},
		extractItemFromSubscription: (item) => item.data.door,
	},
	fetchItem,
	extractLastUpdated: (item) => new Date(item.last_updated),
	listeners,
});

export const Door = () => {
	const [subscriptionStatus, setSubscriptionStatus] = useState(false);
	const [door, setDoor] = useState(undefined);

	const [groundTruthFetchingEnabled, setGroundTruthFetchingEnabled] = useState(false);
	const [groundTruth, setGroundTruth] = useState({loading: false});

	useEffect(() => {
		const subscription = groundTruthFetchingEnabled ? defer(async () => {
			setGroundTruth((state) => ({...state, loading: true}));
			return fetchItem();
		}).pipe(
			repeat({delay: 5000}),
		).subscribe(({
			next: (e) => setGroundTruth({loading: false, item: e, at: new Date()}),
			error: (e) => console.error(e),
		})) : undefined;
		return () => {
			subscription?.unsubscribe();
		};
	}, [groundTruthFetchingEnabled]);

	const [currentTime, setCurrentTime] = useState(new Date());

	useEffect(() => {
		const interval = setInterval(() => setCurrentTime(new Date()), 1000);
		return () => {
			clearInterval(interval);
		};
	}, []);

	useEffect(() => {
		const subscription = updates({
			opened: () => setSubscriptionStatus(true),
			closed: () => setSubscriptionStatus(false),
		}).subscribe({
			next: (e) => setDoor(e),
			error: (e) => console.log("door.error", e),
			complete: () => console.log("door.complete"),
		});
		return () => {
			subscription?.unsubscribe();
		};
	}, []);

	const secondsAgoFormat = new Intl.RelativeTimeFormat("en");

	return html`
		<div>
			<div>Status: ${subscriptionStatus ? "ONLINE" : "OFFLINE"}</div>
			${door === undefined ? html`<div>Initializing</div>` : html`
				<div>${door.open ? "OPEN" : "CLOSE"}</div>
				<div>${secondsAgoFormat.format(Math.round((new Date(door.last_updated).getTime() - currentTime.getTime()) / 1000), "second")}</div>
			`} 
			<div>Ground truth:
				<label>
					<input
						type="checkbox"
						checked=${groundTruthFetchingEnabled}
						onChange=${() => setGroundTruthFetchingEnabled(!groundTruthFetchingEnabled)}
					/>
					Check ground truth
				</label>
				<div>${groundTruth.loading ? "LOADING" : "..."}</div>
				${groundTruth.at && groundTruth.item && html`
					<pre>${JSON.stringify(groundTruth.item, undefined, 4)}</pre>
					<div>${secondsAgoFormat.format(Math.round((groundTruth.at.getTime() - currentTime.getTime()) / 1000), "second")}</div>
				`}
			</div>
		</div>
	`;
};
