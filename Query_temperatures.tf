resource "aws_appsync_function" "Query_temperatures_1" {
  api_id      = aws_appsync_graphql_api.appsync.id
  data_source = aws_appsync_datasource.temperature.name
  name        = "Query_temperatures_1"
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
		query: {
			expression: "#id = :id",
			expressionNames: {
				"#id": "id",
			},
			expressionValues: {
				":id": {S: "1"}
			}
		},
		scanIndexForward: false,
		consistentRead: true,
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
resource "aws_appsync_resolver" "Query_temperatures" {
  api_id = aws_appsync_graphql_api.appsync.id
  type   = "Query"
  field  = "temperatures"
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
      aws_appsync_function.Query_temperatures_1.function_id,
    ]
  }
}
