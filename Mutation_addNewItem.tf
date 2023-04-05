resource "aws_appsync_function" "Mutation_addNewItem_1" {
  api_id      = aws_appsync_graphql_api.appsync.id
  data_source = aws_appsync_datasource.items.name
  name        = "Mutation_addNewItem_1"
  runtime {
    name            = "APPSYNC_JS"
    runtime_version = "1.0.0"
  }
  code = <<EOF
import {util} from "@aws-appsync/utils";
export function request(ctx) {
	return {
		version : "2018-05-29",
		operation : "PutItem",
		key: {
			id: {S: "1"}
		},
		attributeValues: {
			timestamp: {S: util.time.nowISO8601()},
			data: {S: ctx.args.data}
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
resource "aws_appsync_resolver" "Mutation_addNewItem" {
  api_id = aws_appsync_graphql_api.appsync.id
  type   = "Mutation"
  field  = "addNewItem"
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
      aws_appsync_function.Mutation_addNewItem_1.function_id,
    ]
  }
}
