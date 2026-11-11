const Database = require('better-sqlite3')
const path = require('path')

// 数据库文件会生成在 server/data.sqlite
const dbPath = path.join(__dirname, 'data.sqlite')
const db = new Database(dbPath)

// 初始化表：我们只需建一个简单的 Key-Value 表，就能完美替代 localStorage
db.exec(`
  CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

module.exports = db