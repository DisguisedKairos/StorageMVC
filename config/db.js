const mysql = require("mysql2");
require("dotenv").config();

const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "storage_store",
  port: Number(process.env.DB_PORT || process.env.PORT || 3306)
});

db.connect(err => {
  if (err) throw err;
  console.log("Database connected ✅");
});

module.exports = db;
