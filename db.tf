resource "aws_dynamodb_table" "items" {
  name         = "Items-${random_id.id.hex}"
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

resource "aws_dynamodb_table" "singleton" {
  name         = "Singleton-${random_id.id.hex}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
}

resource "aws_dynamodb_table_item" "singleton" {
  table_name = aws_dynamodb_table.singleton.name
  hash_key   = aws_dynamodb_table.singleton.hash_key
  item = <<ITEM
{
  "id": {"S": "1"},
	"data": {"S": "initial"},
	"last_updated": {"S": "2023-03-31T09:44:34.182Z"}
}
ITEM
}
