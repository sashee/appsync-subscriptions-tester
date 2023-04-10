resource "aws_dynamodb_table" "temperature" {
  name         = "Temperature-${random_id.id.hex}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
	range_key = "timestamp"
  attribute {
    name = "id"
    type = "S"
  }
  attribute {
    name = "timestamp"
    type = "S"
  }
}

resource "aws_dynamodb_table" "badge" {
  name         = "Badge-${random_id.id.hex}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  attribute {
    name = "active"
    type = "S"
  }
  attribute {
    name = "last_updated"
    type = "S"
  }
  attribute {
    name = "constant"
    type = "S"
  }

  global_secondary_index {
    name            = "last_updated"
    hash_key        = "constant"
    range_key       = "last_updated"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "active"
    hash_key        = "active"
    range_key       = "last_updated"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "door" {
  name         = "Door-status-${random_id.id.hex}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
}

resource "aws_dynamodb_table_item" "door" {
  table_name = aws_dynamodb_table.door.name
  hash_key   = aws_dynamodb_table.door.hash_key
  item = <<ITEM
{
  "id": {"S": "1"},
	"open": {"BOOL": false},
	"last_updated": {"S": "2023-03-31T09:44:34.182Z"}
}
ITEM
}
