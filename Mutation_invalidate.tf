resource "aws_appsync_function" "Mutation_invalidate_1" {
  api_id      = aws_appsync_graphql_api.appsync.id
  data_source = aws_appsync_datasource.none.name
  name        = "Mutation_invalidate_1"
request_mapping_template = <<EOF
{
	"version": "2018-05-29",
	"payload": {}
}
EOF
response_mapping_template = <<EOF
$extensions.invalidateSubscriptions({
	"subscriptionField": "door",
	"payload": {
		"a": "1"
	}
})

$extensions.invalidateSubscriptions({
	"subscriptionField": "temperature",
	"payload": {
		"a": "1"
	}
})

$extensions.invalidateSubscriptions({
	"subscriptionField": "badge",
	"payload": {
		"a": "1"
	}
})

$ctx.result
EOF
}
resource "aws_appsync_resolver" "Mutation_invalidate" {
  api_id = aws_appsync_graphql_api.appsync.id
  type   = "Mutation"
  field  = "invalidate"
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
      aws_appsync_function.Mutation_invalidate_1.function_id,
    ]
  }
}
