import {SignatureV4} from "@aws-sdk/signature-v4";
import {HttpRequest} from "@aws-sdk/protocol-http";
import {defaultProvider} from "@aws-sdk/credential-provider-node";
import {URL} from "url";
import {Hash} from "@aws-sdk/hash-node";
import {STS} from "@aws-sdk/client-sts";
import { appsyncRealtime } from "./lib.js";

const {APIURL, APIREGION} = process.env;

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
	}
};

const getIAMAuthHeaders = async (APIURL, region, data) => {
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
	return req.headers;
}


appsyncRealtime(APIURL).subscription(({connect, data}) => getIAMAuthHeaders(APIURL + (connect ? "/connect" : ""), APIREGION, data))(`subscription MySubscription {
  singleton {
    data
    last_updated
  }
}
`, {})
	.subscribe(({
		next: (e) => console.log(e),
		error: (e) => console.error(e),
		complete: () => console.log("complete"),
	}));
