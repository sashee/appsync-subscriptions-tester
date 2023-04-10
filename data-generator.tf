# Lambda function

data "archive_file" "lambda_zip" {
  type        = "zip"
  output_path = "/tmp/${random_id.id.hex}-lambda.zip"
	source_file = "data-generator.mjs"
}

resource "aws_lambda_function" "lambda" {
  function_name = "sheduler_example-${random_id.id.hex}-function"

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  handler = "data-generator.handler"
  runtime = "nodejs18.x"
  role    = aws_iam_role.lambda_exec.arn
	timeout = 60
	environment {
		variables = {
			APIURL = aws_appsync_graphql_api.appsync.uris["GRAPHQL"]
			APIREGION = data.aws_region.current.name
		}
	}
}

data "aws_iam_policy_document" "lambda_exec_role_policy" {
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = [
      "arn:aws:logs:*:*:*"
    ]
  }
  statement {
    actions = [
      "appsync:GraphQL",
    ]
    resources = [
			"${aws_appsync_graphql_api.appsync.arn}/*",
    ]
  }
}

resource "aws_cloudwatch_log_group" "loggroup_lambda" {
  name              = "/aws/lambda/${aws_lambda_function.lambda.function_name}"
  retention_in_days = 14
}

resource "aws_iam_role_policy" "lambda_exec_role" {
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_exec_role_policy.json
}

resource "aws_iam_role" "lambda_exec" {
  assume_role_policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
	{
	  "Action": "sts:AssumeRole",
	  "Principal": {
		"Service": "lambda.amazonaws.com"
	  },
	  "Effect": "Allow"
	}
  ]
}
EOF
}

# scheduler

resource "aws_cloudwatch_event_rule" "scheduler" {
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "lambda" {
  rule = aws_cloudwatch_event_rule.scheduler.name
  arn  = aws_lambda_function.lambda.arn
}

resource "aws_lambda_permission" "scheduler" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.lambda.arn
  principal     = "events.amazonaws.com"

  source_arn = aws_cloudwatch_event_rule.scheduler.arn
}
