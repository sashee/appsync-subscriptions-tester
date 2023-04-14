import { appsyncRealtime, persistentSubscription } from "appsync-subscription-observable";
import {Observable, NEVER, ReplaySubject, pipe, timer} from "rxjs";

const {APIKEY, APIURL} = window;

export const getPaginatedResults = async (fn) => {
	const EMPTY = Symbol("empty");
	const res = [];
	for await (const lf of (async function*() {
		let NextMarker = EMPTY;
		while (NextMarker || NextMarker === EMPTY) {
			const {marker, results} = await fn(NextMarker !== EMPTY ? NextMarker : undefined);

			yield* results;
			NextMarker = marker;
		}
	})()) {
		res.push(lf);
	}

	return res;
};

export const sendQuery = async (query, operationName, variables) => {
	const url = new URL(APIURL);
	const res = await fetch(APIURL, {
		method: "POST",
		body: JSON.stringify({query, operationName, variables}),
		headers: {
			"content-type": "application/json; charset=UTF-8",
			"content-encoding": "amz-1.0",
			"accept": "application/json, text/javascript",
			host: url.hostname,
			"x-api-key": APIKEY,
		},
	});

	if (!res.ok) {
		throw new Error("Failed");
	}
	const resJson = await res.json();
	if (resJson.errors) {
		throw new Error(resJson);
	}
	return resJson;
};

export const connection = appsyncRealtime({APIURL, closeDelay: () => timer(6000)});

export {persistentSubscription, APIKEY, APIURL};

