import {connection, sendQuery, persistentSubscription, getIAMAuthRequest, getPaginatedResults, APIREGION, APIURL} from "./utils.js";
import {Observable, Subject, of, from, defer} from "rxjs";
import {tap, retry, map, count, mergeMap, mergeWith, scan, distinctUntilChanged, switchMap, filter} from "rxjs/operators";

const updatesToTemperature = (connection) => ({getAuthorizationHeaders, subscriptionRetryConfig, reopenTimeoutOnError, reopenTimeoutOnComplete, retryFetchDelay, subscription: {query, variables, extractItemFromSubscription}, fetchItems, extractLastUpdated, isValid}) => {
	const opened = new Subject();

	return persistentSubscription(connection)({getAuthorizationHeaders, subscriptionRetryConfig, opened: () => opened.next(), reopenTimeoutOnError, reopenTimeoutOnComplete})(query, variables)
		.pipe(
			map((item) => extractItemFromSubscription(item)),
			map((item) => [item]),
			mergeWith(opened.pipe(
				switchMap(() => defer(() => fetchItems())
				.pipe(
					retry({delay: retryFetchDelay ?? 5000}),
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

const tempUpdateStream = updatesToTemperature(connection)({
	getAuthorizationHeaders: ({connect, data}) => getIAMAuthRequest(APIURL + (connect ? "/connect" : ""), APIREGION, data).then((request) => request.headers),
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
	fetchItems: async () => {
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
	},
	extractLastUpdated,
	isValid,
});

// emit only the latest one
tempUpdateStream
	.pipe(
		scan((acc, items) =>
			[...(acc ? [acc] : []), ...items].sort((a, b) => extractLastUpdated(a) - extractLastUpdated(b)).reverse()[0]
		, undefined),
		distinctUntilChanged(),
	)
	.subscribe(({
		next: (e) => console.log("temperature [only last]", e),
		error: (e) => console.error("temperature [only last] error", e),
		complete: () => console.log("temperature [only last] complete"),
	}));

// emit all
tempUpdateStream
	.pipe(
		mergeMap((items) => items),
	)
	.subscribe(({
		next: (e) => console.log("temperature [all]", e),
		error: (e) => console.error("temperature [all] error", e),
		complete: () => console.log("temperature [all] complete"),
	}));

