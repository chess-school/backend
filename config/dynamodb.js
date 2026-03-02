// config/dynamodb.js

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");

// AWS SDK автоматически подхватит ключи и регион 
// из переменных окружения (AWS_ACCESS_KEY_ID, и т.д.)
const client = new DynamoDBClient({}); 

// Создаем удобный DocumentClient
const docClient = DynamoDBDocumentClient.from(client);

// Экспортируем готовый клиент, чтобы использовать его в других файлах
module.exports = docClient;