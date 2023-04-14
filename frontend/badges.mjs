import {connection, sendQuery, persistentSubscription, APIURL, APIKEY, getPaginatedResults} from "./utils.mjs";
import {Observable, Subject, of, from, defer, ReplaySubject, merge} from "rxjs";
import {tap, retry, map, count, mergeMap, mergeWith, scan, distinctUntilChanged, switchMap, repeat, share, filter, startWith, takeUntil, take} from "rxjs/operators";
import htm from "htm";
import React, {useState, useEffect} from "react";

const html = htm.bind(React.createElement);

const updatesToBadges = (connection) => ({getAuthorizationHeaders, subscriptionRetryConfig, reopenTimeoutOnError, reopenTimeoutOnComplete, retryFetchDelay, subscription: {query, variables, extractItemFromSubscription}, fetchItems, extractLastUpdated, extractId, stopUpdatesForItem, listeners}) => {
	const opened = new Subject();
	const closed = new Subject();
	const fetchedItems = new Subject();
	const subscriptionItems = new Subject();

	opened.subscribe(() => listeners?.opened?.());
	closed.subscribe(() => listeners?.closed?.());

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

const fetchItems = async (afterDate) => {
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
};

const updates = (listeners) => updatesToBadges(connection)({
	getAuthorizationHeaders: () => ({host: new URL(APIURL).host, "x-api-key": APIKEY}),
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
	listeners,
});

export const Badges = () => {
	const [subscriptionStatus, setSubscriptionStatus] = useState(false);
	const [badges, setBadges] = useState([]);

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

	useEffect(() => {
		// share the stream between the two subscriptions
		const badgesStream = updates({
			opened: () => setSubscriptionStatus(true),
			closed: () => setSubscriptionStatus(false),
		});

		const subscription = badgesStream.subscribe({
			next: (items) => setBadges((badges) => [...badges.map((badge) => items.find((item) => extractId(item) === extractId(badge)) ?? badge), ...items.filter((item) => !badges.some((badge) => extractId(badge) === extractId(item)))]),
			error: (e) => console.log("badgesStream.error", e),
			complete: () => console.log("badgesStream.complete"),
		})
		return () => {
			subscription.unsubscribe();
		};
	}, []);

	const secondsAgoFormat = new Intl.RelativeTimeFormat("en");
	const timeAgo = (currentTime, time) => {
		return time ? secondsAgoFormat.format(Math.round((new Date(time).getTime() - currentTime.getTime()) / 1000), "second") : "-"
	}

	const timeAt = (time) => {
		return time ? Intl.DateTimeFormat("en-US", {timeStyle: "medium"}).format(new Date(time)) : "-";
	}

	const sorter = (a, b) => extractLastUpdated(a) - extractLastUpdated(b);
	const issuedAtSorter = (a, b) => new Date(a.issued_at) - new Date(b.issued_at);

	return html`
		<div class="container">
			<div class="row">
				<div class="">
					<div class="card">
						<div class="card-header d-flex justify-content-between">
							Badges<div class="">${subscriptionStatus ? "online" : "offline"}</div>
						</div>
						<div class="card-body">
							<div class="d-flex justify-content-between">
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
							<table class="table caption-top">
							<caption>Last fetched: ${timeAgo(currentTime, groundTruth?.at)}</caption>
								<thead>
									<tr>
										<td>ID</td>
										<td>Issued at</td>
										<td colspan="2">Uses</td>
										<td colspan="2">Last updated</td>
										<td>Returned at</td>
									</tr>
								</thead>
								<tbody>
									${[...badges, ...(groundTruth?.items ?? [])].filter((v, i, a) => a.findIndex((v2) => v2.id === v.id) === i).sort(issuedAtSorter).reverse().map((item) => {
										const streamItem = badges.find(({id}) => id === item.id);
										const groundTruthItem = (groundTruth?.items ?? []).find(({id}) => id === item.id);
										const cellColor = (fn) => {
											if (!item.returned_at) {
												if (!streamItem || !groundTruthItem) {
													return "table-warning";
												}else if (fn(streamItem) !== fn(groundTruthItem)){
													if (streamItem.last_updated > groundTruthItem.last_updated) {
														return "table-info";
													}else {
														return "table-danger";
													}
												}
											}
											return "";
										}
										return html`
											<tr class="${item.returned_at ? "table-secondary" : ""}">
												<td>${item.id}</td>
												<td>${timeAt(item.issued_at)}</td>
												<td class="${cellColor((item) => item.use_count)}">${streamItem?.use_count ?? "-"}</td>
												<td class="text-muted text-small ${cellColor((item) => item.use_count)}">${groundTruthItem?.use_count ?? "-"}</td>
												<td class="${cellColor((item) => item.last_updated)}">${timeAt(streamItem?.last_updated)}</td>
												<td class="text-muted text-small ${cellColor((item) => item.last_updated)}">${timeAt(groundTruthItem?.last_updated)}</td>
												<td>${timeAt(streamItem?.returned_at)}</td>
											</tr>
										`;
									})}
								</tbody>
							</table>
						</div>
						<div class="card-footer text-muted">
							<div>Last change: ${timeAgo(currentTime, [...badges].sort(sorter).reverse()[0]?.last_updated)}</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	`;
};

