resource "aws_appsync_function" "Subscription_badge_1" {
  api_id      = aws_appsync_graphql_api.appsync.id
  data_source = aws_appsync_datasource.none.name
  name        = "Subscription_badge_1"
  runtime {
    name            = "APPSYNC_JS"
    runtime_version = "1.0.0"
  }
  code = <<EOF
import {util} from "@aws-appsync/utils";
export function request(ctx) {
	return {
		version : "2018-05-29",
	};
}
export function response(ctx) {
	if (ctx.error) {
		return util.error(ctx.error.message, ctx.error.type);
	}
	extensions.setSubscriptionInvalidationFilter({
		filterGroup: [{
			filters: [
				{
					fieldName: "a",
					"operator": "eq",
					"value": "1"
				}
			]
		}]
	});
	return ctx.result;
}
EOF
}
resource "aws_appsync_resolver" "Subscription_badge" {
  api_id = aws_appsync_graphql_api.appsync.id
  type   = "Subscription"
  field  = "badge"
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
      aws_appsync_function.Subscription_badge_1.function_id,
    ]
  }
}
