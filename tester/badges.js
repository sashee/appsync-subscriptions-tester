import {connection, sendQuery, persistentSubscription, getIAMAuthRequest, getPaginatedResults, APIREGION, APIURL} from "./utils.js";
import {Observable, Subject, of, from, defer, noop, ReplaySubject, merge} from "rxjs";
import {tap, retry, map, count, mergeMap, mergeWith, scan, distinctUntilChanged, switchMap, filter, takeUntil, startWith, withLatestFrom, share, take} from "rxjs/operators";

const updatesToBadges = (connection) => ({getAuthorizationHeaders, subscriptionRetryConfig, reopenTimeoutOnError, reopenTimeoutOnComplete, retryFetchDelay, subscription: {query, variables, extractItemFromSubscription}, fetchItems, extractLastUpdated, extractId, stopUpdatesForItem}) => {
	const opened = new Subject();
	const closed = new Subject();
	const fetchedItems = new Subject();
	const subscriptionItems = new Subject();

	const lastGoodPoint = fetchedItems.pipe(
		switchMap((items) => merge(
			from(items),
			subscriptionItems,
		).pipe(
			takeUntil(closed),
		)),
		scan((acc, value) => {
			const lastUpdated = extractLastUpdated(value);
			return lastUpdated > acc ? lastUpdated : acc;
		}, new Date(0)),
		distinctUntilChanged(),
		startWith(undefined),
		share({connector: () => new ReplaySubject(1), resetOnRefCountZero: false}),
	);

	return persistentSubscription(connection)({getAuthorizationHeaders, subscriptionRetryConfig, opened: () => opened.next(), closed: () => closed.next(), reopenTimeoutOnError, reopenTimeoutOnComplete})(query, variables)
		.pipe(
			map((item) => extractItemFromSubscription(item)),
			tap((e) => subscriptionItems.next(e)),
			map((item) => [item]),
			mergeWith(opened.pipe(
				switchMap(() => defer(
					() => lastGoodPoint.pipe(
						take(1),
						mergeMap((afterDate) => fetchItems(afterDate))
					).pipe(tap((items) => fetchedItems.next(items)))
				)
				.pipe(
					retry({delay: retryFetchDelay ?? 5000}),
				)),
			)),
			scan(({cache}, items) => {
				const newItems = items.filter((item) => {
					const lastUpdated = extractLastUpdated(item);
					const id = extractId(item);
					return cache.every((cacheItem) => extractId(cacheItem) !== id || lastUpdated.getTime() !== extractLastUpdated(cacheItem).getTime());
				});
				return {
					cache: [...cache, ...newItems].filter((item) => !stopUpdatesForItem(item)),
					emit: newItems,
				};
			}, {cache: [], emit: []}),
			map(({emit}) => emit),
			filter((items) => items.length > 0),
		);
};

const extractLastUpdated = (item) => new Date(item.last_updated);
const extractId = (item) => item.id;

const stopUpdatesForItem = ({returned_at}) => returned_at !== null;

updatesToBadges(connection)({
	getAuthorizationHeaders: ({connect, data}) => getIAMAuthRequest(APIURL + (connect ? "/connect" : ""), APIREGION, data).then((request) => request.headers),
	subscription: {
		query: `subscription MySubscription {
  badge {
		id
		issued_at
		returned_at
		use_count
    last_updated
  }
}
`,
		variables: {},
		extractItemFromSubscription: (item) => item.data.badge,
	},
	fetchItems: async (afterDate) => {
		const results = await getPaginatedResults(async (nextToken) => {
			const query = `query MyQuery($nextToken: String, $onlyActive: Boolean!) {
  badges(nextToken: $nextToken, onlyActive: $onlyActive) {
		nextToken
		items {
			id
			issued_at
			returned_at
			use_count
			last_updated
		}
  }
}`;
			const operationName = "MyQuery";
			const variables = {nextToken, onlyActive: afterDate === undefined};
			const resJson = await sendQuery(query, operationName, variables);
			// stop paginating if we got all incremental updates
			const shouldContinue = afterDate === undefined || resJson.data.badges.items.every((item) => extractLastUpdated(item) > afterDate);
			return {
				marker: shouldContinue ? resJson.data.badges.nextToken : undefined,
				results: resJson.data.badges.items.filter((item) => afterDate === undefined || extractLastUpdated(item) > afterDate),
			};
		});
		return results;
	},
	extractLastUpdated,
	extractId,
	stopUpdatesForItem,
})
	.pipe(
		mergeMap((items) => items),
	)
	.subscribe(({
		next: (e) => console.log("badge", e),
		error: (e) => console.error("badge error", e),
		complete: () => console.log("badge complete"),
	}));
