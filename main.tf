provider "aws" {
}
data "aws_region" "current" {}
resource "random_id" "id" {
  byte_length = 8
}
resource "aws_iam_role" "appsync" {
  assume_role_policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Principal": {
        "Service": "appsync.amazonaws.com"
      },
      "Effect": "Allow"
    }
  ]
}
EOF
}
data "aws_iam_policy_document" "appsync" {
  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query",
    ]
    resources = [
      aws_dynamodb_table.door.arn,
      aws_dynamodb_table.temperature.arn,
      aws_dynamodb_table.badge.arn,
      "${aws_dynamodb_table.badge.arn}/*",
    ]
  }
}
resource "aws_iam_role_policy" "appsync" {
  role   = aws_iam_role.appsync.id
  policy = data.aws_iam_policy_document.appsync.json
}
resource "aws_appsync_graphql_api" "appsync" {
  name                = "subscriptions-tester"
  schema              = file("schema.graphql")
  authentication_type = "AWS_IAM"
  log_config {
    cloudwatch_logs_role_arn = aws_iam_role.appsync_logs.arn
    field_log_level          = "ALL"
  }
}
data "aws_iam_policy_document" "appsync_push_logs" {
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = [
      "arn:aws:logs:*:*:*"
    ]
  }
}
resource "aws_iam_role" "appsync_logs" {
  assume_role_policy = <<POLICY
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Effect": "Allow",
			"Principal": {
				"Service": "appsync.amazonaws.com"
			},
			"Action": "sts:AssumeRole"
		}
	]
}
POLICY
}
resource "aws_iam_role_policy" "appsync_logs" {
  role   = aws_iam_role.appsync_logs.id
  policy = data.aws_iam_policy_document.appsync_push_logs.json
}
resource "aws_cloudwatch_log_group" "loggroup" {
  name              = "/aws/appsync/apis/${aws_appsync_graphql_api.appsync.id}"
  retention_in_days = 14
}
resource "aws_appsync_datasource" "temperature" {
  api_id           = aws_appsync_graphql_api.appsync.id
  name             = "temperature"
  service_role_arn = aws_iam_role.appsync.arn
  type             = "AMAZON_DYNAMODB"
  dynamodb_config {
    table_name = aws_dynamodb_table.temperature.name
  }
}

resource "aws_appsync_datasource" "door" {
  api_id           = aws_appsync_graphql_api.appsync.id
  name             = "door"
  service_role_arn = aws_iam_role.appsync.arn
  type             = "AMAZON_DYNAMODB"
  dynamodb_config {
    table_name = aws_dynamodb_table.door.name
  }
}

resource "aws_appsync_datasource" "badge" {
  api_id           = aws_appsync_graphql_api.appsync.id
  name             = "badge"
  service_role_arn = aws_iam_role.appsync.arn
  type             = "AMAZON_DYNAMODB"
  dynamodb_config {
    table_name = aws_dynamodb_table.badge.name
  }
}

resource "aws_appsync_datasource" "none" {
  api_id           = aws_appsync_graphql_api.appsync.id
  name             = "none"
  service_role_arn = aws_iam_role.appsync.arn
  type             = "NONE"
}

output "APIURL" {
  value = aws_appsync_graphql_api.appsync.uris["GRAPHQL"]
}

output "APIRegion" {
  value = data.aws_region.current.name
}
