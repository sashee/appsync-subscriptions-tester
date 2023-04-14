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
					retry({delay: retryFetchDelay ?? 15000}),
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

	const [groundTruthFetchingEnabled, setGroundTruthFetchingEnabled] = useState(true);
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
		<div class="container">
			<details class="mb-5">
				<summary>Usage</summary>
				<p class="mt-2">This page shows the real-time status of a door. It can be either opened or closed and it can change every 10 seconds.</p>
				<p>The box on the left shows the status of the real-time connection to an AppSync API. On the right is the "ground truth", data fetched every 5 seconds. With this, it's easy to compare with the real-time channel.</p>
				<p>The connection is terminated from time to time and it reconnects after 15 seconds. That means it might miss some updates. A reconnect mechanism makes a fetch in this case so that the data is always up-to-date.</p>
			</details>
			<div class="row">
				<div class="col-md-4 offset-md-1">
					<div class="card">
						<div class="card-header d-flex justify-content-between">
							Door status <div class="">${door === undefined ? "Initializing..." : subscriptionStatus ? "online" : "offline"}</div>
						</div>
						<div class="card-body">
							<div>${door === undefined ? "Initializing..." : (door.open ? "Opened" : "Closed")}</div>
						</div>
						<div class="card-footer text-muted">
							<div>Last change: ${door !== undefined ? secondsAgoFormat.format(Math.round((new Date(door.last_updated).getTime() - currentTime.getTime()) / 1000), "second") : "-"}</div>
						</div>
					</div>
				</div>
				<div class="col-md-4 offset-md-2">
					<div class="card">
						<div class="card-header d-flex justify-content-between">
							<label>
								<input
									type="checkbox"
									checked=${groundTruthFetchingEnabled}
									onChange=${() => setGroundTruthFetchingEnabled(!groundTruthFetchingEnabled)}
								/>
								Check ground truth
							</label>
							<div class="">${groundTruth.loading ? "Fetching..." : ""}</div>
						</div>
						<div class="card-body ${!groundTruthFetchingEnabled ? "text-muted" : ""}">
							<div>${groundTruth.item === undefined ? "-": groundTruth.item.open ? "Opened" : "Closed"}</div>
							<div>Last change: ${groundTruth?.item?.last_updated !== undefined ? secondsAgoFormat.format(Math.round((new Date(groundTruth.item.last_updated).getTime() - currentTime.getTime()) / 1000), "second") : "-"}</div>
						</div>
						<div class="card-footer text-muted">
							<div>Last fetched: ${groundTruth?.at !== undefined ? secondsAgoFormat.format(Math.round((new Date(groundTruth.at).getTime() - currentTime.getTime()) / 1000), "second") : "-"}</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	`;
};
