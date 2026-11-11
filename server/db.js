const Database = require('better-sqlite3')
const path = require('path')

// 优先使用 index.js 传过来的可写路径，否则默认在 server 目录
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data.sqlite')

const db = new Database(dbPath)

// 初始化表
db.exec(`
  CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

module.exports = db