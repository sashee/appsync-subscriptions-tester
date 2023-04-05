resource "aws_appsync_function" "Mutation_updateSingleton_1" {
  api_id      = aws_appsync_graphql_api.appsync.id
  data_source = aws_appsync_datasource.singleton.name
  name        = "Mutation_updateSingleton_1"
  runtime {
    name            = "APPSYNC_JS"
    runtime_version = "1.0.0"
  }
  code = <<EOF
import {util} from "@aws-appsync/utils";
export function request(ctx) {
	return {
		version : "2018-05-29",
		operation : "UpdateItem",
		key: {
			id: {S: "1"}
		},
		update: {
			expression: "SET #data = :data, #last_updated = :last_updated",
			expressionNames: {
				"#data": "data",
				"#last_updated": "last_updated",
			},
			expressionValues: {
				":data": {S: ctx.args.data},
				":last_updated": {S: util.time.nowISO8601()},
			}
		}
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
resource "aws_appsync_resolver" "Mutation_updateSingleton" {
  api_id = aws_appsync_graphql_api.appsync.id
  type   = "Mutation"
  field  = "updateSingleton"
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
      aws_appsync_function.Mutation_updateSingleton_1.function_id,
    ]
  }
}
