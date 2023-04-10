resource "aws_appsync_function" "Mutation_updateBadge_1" {
  api_id      = aws_appsync_graphql_api.appsync.id
  data_source = aws_appsync_datasource.badge.name
  name        = "Mutation_updateBadge_1"
  runtime {
    name            = "APPSYNC_JS"
    runtime_version = "1.0.0"
  }
  code = <<EOF
import {util} from "@aws-appsync/utils";
export function request(ctx) {
	if (ctx.args.id) {
		return {
			version : "2018-05-29",
			operation : "UpdateItem",
			key: {
				id: {S: ctx.args.id}
			},
			update: {
				expression: "SET " + (ctx.args.return_badge ? "#returned_at = :returned_at, #active = :active, " : "") + "#last_updated = :last_updated, #use_count = #use_count + :use_count",
				expressionNames: {
					...(ctx.args.return_badge ? {"#returned_at": "returned_at", "#active": "active"} : {}),
					"#last_updated": "last_updated",
					"#use_count": "use_count",
				},
				expressionValues: {
					...(ctx.args.return_badge ? {":returned_at": {S: util.time.nowISO8601()}, ":active": {S: "false"}} : {}),
					":use_count": {N: ctx.args.increment_uses ? 1 : 0},
					":last_updated": {S: util.time.nowISO8601()},
				}
			}
		};
	}else {
		return {
			version: "2018-05-29",
			operation: "PutItem",
			key: {
				id: {S: util.autoId()},
			},
			attributeValues: {
				issued_at: {S: util.time.nowISO8601()},
				last_updated: {S: util.time.nowISO8601()},
				use_count: {N: "0"},
				active: {S: "true"},
				constant: {S: "1"},
			}
		}
	}
}
export function response(ctx) {
	if (ctx.error) {
		return util.error(ctx.error.message, ctx.error.type);
	}
	return ctx.result;
}
EOF
}
resource "aws_appsync_resolver" "Mutation_updateBadge" {
  api_id = aws_appsync_graphql_api.appsync.id
  type   = "Mutation"
  field  = "updateBadge"
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
      aws_appsync_function.Mutation_updateBadge_1.function_id,
    ]
  }
}
