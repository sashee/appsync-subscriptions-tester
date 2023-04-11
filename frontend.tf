resource "aws_s3_bucket" "frontend_bucket" {
  force_destroy = "true"
}

locals {
  # Maps file extensions to mime types
  # Need to add more if needed
  mime_type_mappings = {
    html = "text/html",
    js   = "text/javascript",
    mjs  = "text/javascript",
    css  = "text/css"
  }
}

resource "aws_s3_object" "frontend_object" {
  for_each = fileset("${path.module}/frontend", "*")
  key      = each.value
  source   = "${path.module}/frontend/${each.value}"
  bucket   = aws_s3_bucket.frontend_bucket.bucket

  etag          = filemd5("${path.module}/frontend/${each.value}")
  content_type  = local.mime_type_mappings[concat(regexall("\\.([^\\.]*)$", each.value), [[""]])[0][0]]
  cache_control = "no-store, max-age=0"
}

resource "aws_s3_object" "frontend_config" {
  key     = "config.mjs"
  content = <<EOF
window.APIKEY = "${aws_appsync_api_key.apikey.key}";
window.APIURL = "${aws_appsync_graphql_api.appsync.uris["GRAPHQL"]}";
EOF
  bucket  = aws_s3_bucket.frontend_bucket.bucket

  content_type  = "text/javascript"
  cache_control = "no-store, max-age=0"
}

resource "aws_cloudfront_distribution" "distribution" {
  origin {
    domain_name              = aws_s3_bucket.frontend_bucket.bucket_regional_domain_name
    origin_id                = "s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
  }

  enabled             = true
  default_root_object = "index.html"
  is_ipv6_enabled     = true
  http_version        = "http2and3"

  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "s3"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_s3_bucket_policy" "oac" {
  bucket = aws_s3_bucket.frontend_bucket.id
  policy = data.aws_iam_policy_document.s3_policy.json
}

data "aws_iam_policy_document" "s3_policy" {
  statement {
    actions = ["s3:GetObject"]

    resources = ["${aws_s3_bucket.frontend_bucket.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.distribution.arn]
    }
  }
}

resource "aws_cloudfront_origin_access_control" "oac" {
  name                              = "oac-${random_id.id.hex}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

output "domain" {
  value = aws_cloudfront_distribution.distribution.domain_name
}

