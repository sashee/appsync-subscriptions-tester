import {connection, sendQuery, persistentSubscription, APIURL, APIKEY, getPaginatedResults} from "./utils.mjs";
import {Observable, Subject, of, from, defer} from "rxjs";
import {tap, retry, map, count, mergeMap, mergeWith, scan, distinctUntilChanged, switchMap, repeat, share, filter} from "rxjs/operators";
import htm from "htm";
import React, {useState, useEffect} from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const html = htm.bind(React.createElement);

const debugTap = (label) => tap({
	subscribe: () => console.log(`${label}.subscribe`),
	next: (e) => console.log(`${label}.next`, e),
	error: (e) => console.log(`${label}.error`, e),
	complete: () => console.log(`${label}.complete`),
	unsubscribe: () => console.log(`${label}.unsubscribe`),
	finalize: () => console.log(`${label}.finalize`),
});
const updatesToTemperature = (connection) => ({getAuthorizationHeaders, subscriptionRetryConfig, reopenTimeoutOnError, reopenTimeoutOnComplete, retryFetchDelay, subscription: {query, variables, extractItemFromSubscription}, fetchItems, extractLastUpdated, isValid, listeners}) => {
	const opened = new Subject();

	opened.subscribe(() => listeners?.opened?.());

	return persistentSubscription(connection)({getAuthorizationHeaders, subscriptionRetryConfig, opened: () => opened.next(), closed: (e) => listeners?.closed?.(e), reopenTimeoutOnError, reopenTimeoutOnComplete})(query, variables)
		.pipe(
			map((item) => extractItemFromSubscription(item)),
			map((item) => [item]),
			mergeWith(opened.pipe(
				switchMap(() => defer(() => fetchItems())
				.pipe(
					retry({delay: retryFetchDelay ?? 15000}),
				)),
			)),
			scan(({cache}, items) => {
				const newItems = items.filter((item) => {
					const lastUpdated = extractLastUpdated(item);
					return cache.every((cacheItem) => lastUpdated.getTime() !== extractLastUpdated(cacheItem).getTime());
				});
				return {
					cache: [...cache, ...newItems].filter((item) => isValid(item)),
					emit: newItems.filter((item) => isValid(item)),
				};
			}, {cache: [], emit: []}),
			map(({emit}) => emit),
			filter((items) => items.length > 0),
		);
};

const extractLastUpdated = (item) => new Date(item.timestamp);

// only emit temperatures from the last 5 minutes
const isValid = ({timestamp}) => new Date(timestamp).getTime() + 5 * 60 * 1000 > new Date().getTime();

const fetchItems = async () => {
	const results = await getPaginatedResults(async (nextToken) => {
		const query = `query MyQuery($nextToken: String) {
temperatures(nextToken: $nextToken) {
	nextToken
	items {
		value
		timestamp
	}
}
}`;
		const operationName = "MyQuery";
		const variables = {nextToken};
		const resJson = await sendQuery(query, operationName, variables);
		// stop paginating if we got all the temperatures for the last 5 minutes
		const shouldContinue = resJson.data.temperatures.items.every((item) => isValid(item));
		return {
			marker: shouldContinue ? resJson.data.temperatures.nextToken : undefined,
			results: resJson.data.temperatures.items,
		};
	});
	return results;
};

const tempUpdateStream = (listeners) => updatesToTemperature(connection)({
	getAuthorizationHeaders: () => ({host: new URL(APIURL).host, "x-api-key": APIKEY}),
	subscription: {
		query: `subscription MySubscription {
  temperature {
    value
    timestamp
  }
}
`,
		variables: {},
		extractItemFromSubscription: (item) => item.data.temperature,
	},
	extractLastUpdated,
	isValid,
	fetchItems,
	listeners,
});

export const Temperature = () => {
	const [subscriptionStatus, setSubscriptionStatus] = useState(false);
	const [temperaturesMonotonic, setTemperaturesMonotonic] = useState([]);
	const [temperaturesAll, setTemperaturesAll] = useState([]);

	const [groundTruthFetchingEnabled, setGroundTruthFetchingEnabled] = useState(true);
	const [groundTruth, setGroundTruth] = useState({loading: false});

	useEffect(() => {
		const subscription = groundTruthFetchingEnabled ? defer(async () => {
			setGroundTruth((state) => ({...state, loading: true}));
			return fetchItems();
		}).pipe(
			repeat({delay: 5000}),
		).subscribe(({
			next: (e) => setGroundTruth({loading: false, items: e, at: new Date()}),
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

	const sorter = (a, b) => extractLastUpdated(a) - extractLastUpdated(b);

	useEffect(() => {
		// share the stream between the two subscriptions
		const tempStream = tempUpdateStream({
			opened: () => setSubscriptionStatus(true),
			closed: () => setSubscriptionStatus(false),
		}).pipe(share());

		// emit only the last item
		const subscription1 = tempStream.pipe(
			scan((acc, items) =>
				[...(acc ? [acc] : []), ...items].sort(sorter).reverse()[0]
			, undefined),
			distinctUntilChanged(),
		).subscribe({
			next: (e) => setTemperaturesMonotonic((temperaturesMonotonic) => [...temperaturesMonotonic, e]),
			error: (e) => console.log("temperaturesMonotonic.error", e),
			complete: () => console.log("temperaturesMonotonic.complete"),
		});

		// emit all items
		const subscription2 = tempStream.pipe(
			mergeMap((items) => items),
		).subscribe({
			next: (e) => setTemperaturesAll((temperaturesAll) => [...temperaturesAll, e]),
			error: (e) => console.log("temperaturesAll.error", e),
			complete: () => console.log("temperaturesAll.complete"),
		})
		return () => {
			subscription1?.unsubscribe();
			subscription2?.unsubscribe();
		};
	}, []);

	const secondsAgoFormat = new Intl.RelativeTimeFormat("en");

	const renderChart = (values, title) => html`
		<div style=${{height: "250px"}}>
			<${ResponsiveContainer}>
				<${LineChart}
					width=${500}
					height=${300}
					data=${values.filter(isValid).sort(sorter)}
					margin=${{
						top: 5,
						right: 30,
						left: 20,
						bottom: 5,
					}}
					title=${title}
				>
					<${CartesianGrid} strokeDasharray="3 3" />
					<${XAxis} dataKey="timestamp" />
					<${YAxis} domain=${["auto", "auto"]}/>
					<${Tooltip} />
					<${Line} isAnimationActive=${false} type="monotone" dataKey="value" stroke="#8884d8" activeDot=${{ r: 8 }} />
				<//>
			<//>
		</div>
	`;

	return html`
		<div class="container">
			<details class="mb-5">
				<summary>Usage</summary>
				<p class="mt-2">This page shows the real-time values of a temperature sensor. It sends a measurement every 10 seconds.</p>
				<p>The box on the left shows the status of the real-time connection to an AppSync API. On the right is the "ground truth", data fetched every 5 seconds.</p>
				<p>The top chart is updated only with the latest temperature value. This means if it misses some values, there will be gaps. The bottom chart shows all values for the last 5 minutes</p>
				<p>The connection is terminated from time to time and it reconnects after 15 seconds. That means it might miss some updates. A reconnect mechanism makes a fetch in this case so that the data is always up-to-date.</p>
				<p>Due to the different timing of the two boxes, it is possible that the "ground truth" does not show a value that already appears on the left. After the next update, the value should appear.</p>
			</details>
			<div class="row">
				<div class="col-md-4 offset-md-1">
					<div class="card">
						<div class="card-header d-flex justify-content-between">
							Temperatures<div class="">${subscriptionStatus ? "online" : "offline"}</div>
						</div>
						<div class="card-body">
							${renderChart(temperaturesMonotonic, "Monothonic values")}
							${renderChart(temperaturesAll, "All values")}
						</div>
						<div class="card-footer text-muted">
							<div>Last change: ${temperaturesAll.length > 0 ? secondsAgoFormat.format(Math.round((new Date([...temperaturesAll].sort(sorter).reverse()[0].timestamp).getTime() - currentTime.getTime()) / 1000), "second") : "-"}</div>
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
						<div class="card-body">
							${renderChart(groundTruth?.items ?? [], "Items in the database")}
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

