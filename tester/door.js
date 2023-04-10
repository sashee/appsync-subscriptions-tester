import {connection, sendQuery, persistentSubscription, getIAMAuthRequest, APIREGION, APIURL} from "./utils.js";
import {Observable, Subject, of, from, defer} from "rxjs";
import {tap, retry, map, count, mergeMap, mergeWith, scan, distinctUntilChanged, switchMap} from "rxjs/operators";

const updatesToDoor = (connection) => ({getAuthorizationHeaders, subscriptionRetryConfig, reopenTimeoutOnError, reopenTimeoutOnComplete, retryFetchDelay, subscription: {query, variables, extractItemFromSubscription}, fetchItem, extractLastUpdated}) => {
	const opened = new Subject();

	return persistentSubscription(connection)({getAuthorizationHeaders, subscriptionRetryConfig, opened: () => opened.next(), reopenTimeoutOnError, reopenTimeoutOnComplete})(query, variables)
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

updatesToDoor(connection)({
	getAuthorizationHeaders: ({connect, data}) => getIAMAuthRequest(APIURL + (connect ? "/connect" : ""), APIREGION, data).then((request) => request.headers),
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
	fetchItem: async () => {
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
	},
	extractLastUpdated: (item) => new Date(item.last_updated),
})
	.subscribe(({
		next: (e) => console.log("door updates", e),
		error: (e) => console.error("error with door updates", e),
		complete: () => console.log("door updates complete"),
	}));


