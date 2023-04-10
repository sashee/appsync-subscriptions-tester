import {setTimeout} from "node:timers/promises";
import {SignatureV4} from "@aws-sdk/signature-v4";
import {HttpRequest} from "@aws-sdk/protocol-http";
import {defaultProvider} from "@aws-sdk/credential-provider-node";
import {URL} from "url";
import {Hash} from "@aws-sdk/hash-node";

const {APIURL, APIREGION} = process.env;

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
		credentials: defaultProvider(),
		service: "appsync",
		region: region,
		sha256: Hash.bind(null, "sha256"),
	});
	const req = await signer.sign(httpRequest);
	return req;
};

const sendQuery = async (query, operationName, variables) => {
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

const updateDoor = async () => {
	const shouldChange = Math.random() < 0.5;
	if (shouldChange) {
		const doorStatus = (await sendQuery(`query MyQuery {
	door {
		open
		last_updated
	}
}`, "MyQuery", {})).data.door.open;
		await sendQuery(`mutation MyMutation($open: Boolean!) {
  updateDoor(open: $open) {
    last_updated
    open
  }
		}`, "MyMutation", {open: !doorStatus});
	}
};

const updateTemperature = async () => {
	const lastTemp = (await sendQuery(`query MyQuery {
  temperatures {
    items {
      value
    }
  }
}`, "MyQuery", {})).data.temperatures.items[0]?.value ?? 20;
	await sendQuery(`mutation MyMutation($value: Float!) {
  registerTemperature(value: $value) {
    timestamp
    value
  }
}`, "MyMutation", {value: lastTemp + Math.round((Math.random() * 2 - 1) * 100) / 100});
};

const getPaginatedResults = async (fn) => {
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

const updateBadges = async () => {
	const allActiveBadges = await getPaginatedResults(async (nextToken) => {
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
		const variables = {nextToken, onlyActive: true};
		const resJson = await sendQuery(query, operationName, variables);
		return {
			marker: resJson.data.badges.nextToken,
			results: resJson.data.badges.items,
		};
	});
	const addNewBadge = async () => {
		await sendQuery(`mutation MyMutation {
  updateBadge {
    id
    issued_at
    last_updated
    returned_at
    use_count
  }
}
`, "MyMutation", {});
	};
	const updateExistingBadges = Promise.all(allActiveBadges.map(async ({id}) => {
		const shouldReturn = Math.random() < 0.05;
		const shouldIncrement = !shouldReturn && Math.random() < 0.4;
		if (shouldReturn || shouldIncrement) {
			await sendQuery(`mutation MyMutation($id: ID, $increment_uses: Boolean, $return_badge: Boolean) {
  updateBadge(id: $id, increment_uses: $increment_uses, return_badge: $return_badge) {
    id
    issued_at
    last_updated
    returned_at
    use_count
  }
}
`, "MyMutation", {
				id,
				increment_uses: shouldIncrement,
				return_badge: shouldReturn,
			});
		}
	}));
	const shouldCreateNew = Math.random() < 0.3;
	await Promise.all([
		...(shouldCreateNew ? [addNewBadge()] : []),
		updateExistingBadges,
	]);
};

const invalidate = async () => {
	const shouldInvalidate = Math.random() < 0.2;
	if (shouldInvalidate) {
		await sendQuery(`mutation MyMutation {
  invalidate
}`, "MyMutation", {});
	}
};

const updateData = async () => {
	await Promise.all([
		updateDoor(),
		updateTemperature(),
		updateBadges(),
		invalidate(),
	]);
};

export const handler = async (event, context) => {
	await updateData();
	while(context.getRemainingTimeInMillis() > 15000) {
		console.log(context.getRemainingTimeInMillis());
		await setTimeout(10000);
		await updateData();
	}
};

