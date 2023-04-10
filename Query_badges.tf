resource "aws_appsync_function" "Query_badges_1" {
  api_id      = aws_appsync_graphql_api.appsync.id
  data_source = aws_appsync_datasource.badge.name
  name        = "Query_badges_1"
  runtime {
    name            = "APPSYNC_JS"
    runtime_version = "1.0.0"
  }
  code = <<EOF
import {util} from "@aws-appsync/utils";
export function request(ctx) {
	return {
		version : "2018-05-29",
		operation : "Query",
		...(ctx.args.onlyActive ? {
			index: "active",
			query: {
				expression: "#active = :active",
				expressionNames: {
					"#active": "active",
				},
				expressionValues: {
					":active": {S: "true"}
				}
			},
		} : {
			index: "last_updated",
			query: {
				expression: "#constant = :constant",
				expressionNames: {
					"#constant": "constant",
				},
				expressionValues: {
					":constant": {S: "1"}
				}
			},
		}),
		scanIndexForward: false,
		limit: 2,
		nextToken: ctx.args.nextToken,
	};
}
export function response(ctx) {
	if (ctx.error) {
		return util.error(ctx.error.message, ctx.error.type);
	}
	return ctx.result;
}
EOF
}
resource "aws_appsync_resolver" "Query_badges" {
  api_id = aws_appsync_graphql_api.appsync.id
  type   = "Query"
  field  = "badges"
  runtime {
    name            = "APPSYNC_JS"
    runtime_version = "1.0.0"
  }
  code = <<EOF
export function request(ctx) {
	return {};
}
export function response(ctx) {
	return ctx.result;
}
EOF
  kind = "PIPELINE"
  pipeline_config {
    functions = [
      aws_appsync_function.Query_badges_1.function_id,
    ]
  }
}
