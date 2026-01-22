const mysql = require("mysql2");
require("dotenv").config();

const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "storage_store",
  port: Number(process.env.DB_PORT || 3306),
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

db.connect(err => {
  if (err) throw err;
  console.log("Database connected ✅");
});

module.exports = db;
