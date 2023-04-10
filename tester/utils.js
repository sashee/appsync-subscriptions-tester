import {SignatureV4} from "@aws-sdk/signature-v4";
import {HttpRequest} from "@aws-sdk/protocol-http";
import {defaultProvider} from "@aws-sdk/credential-provider-node";
import {URL} from "url";
import {Hash} from "@aws-sdk/hash-node";
import {STS} from "@aws-sdk/client-sts";
import { appsyncRealtime, persistentSubscription } from "./lib.js";
import WebSocket from "ws";

const {APIURL, APIREGION} = process.env;

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

const assume = async (sourceCreds, params) => {
	const sts = new STS({credentials: sourceCreds});
	const result = await sts.assumeRole(params);
	if(!result.Credentials) {
		throw new Error("unable to assume credentials - empty credential object");
	}
	return {
		accessKeyId: String(result.Credentials.AccessKeyId),
		secretAccessKey: String(result.Credentials.SecretAccessKey),
		sessionToken: result.Credentials.SessionToken
	};
};

export const getIAMAuthRequest = async (APIURL, region, data) => {
	const url = new URL(APIURL);
	const httpRequest = new HttpRequest({
		body: JSON.stringify(data),
		headers: {
			"content-type": "application/json; charset=UTF-8",
			"content-encoding": "amz-1.0",
			"accept": "application/json, text/javascript",
			host: url.hostname,
		},
		hostname: url.hostname,
		method: "POST",
		path: url.pathname,
		protocol: url.protocol,
		query: {},
	});
	
	const signer = new SignatureV4({
		credentials: defaultProvider({roleAssumer: assume}),
		service: "appsync",
		region: region,
		sha256: Hash.bind(null, "sha256"),
	});
	const req = await signer.sign(httpRequest);
	return req;
};

export const sendQuery = async (query, operationName, variables) => {
	const req = await getIAMAuthRequest(APIURL, APIREGION, {query, operationName, variables});
	const res = await fetch(`${req.protocol}//${req.hostname}${req.path}`, {
		method: req.method,
		body: req.body,
		headers: req.headers,
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

export const connection = appsyncRealtime({APIURL, WebSocketCtor: WebSocket});

export {persistentSubscription, APIREGION, APIURL};
