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

// 预编译语句：HTTP 路由与 Electron IPC 共用同一套读写语义
const selectStmt = db.prepare('SELECT value FROM kv_store WHERE key = ?')
const upsertStmt = db.prepare(`
  INSERT INTO kv_store (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
`)
const deleteStmt = db.prepare('DELETE FROM kv_store WHERE key = ?')

/** 读取一个键，不存在时返回 null */
function getKV(key) {
  const row = selectStmt.get(String(key))
  return row ? row.value : null
}

/** 写入一个键；value 为 null / undefined 时等价于删除 */
function setKV(key, value) {
  if (value === null || value === undefined) {
    deleteStmt.run(String(key))
  } else {
    upsertStmt.run(String(key), String(value))
  }
  return true
}

module.exports = { db, getKV, setKV }
