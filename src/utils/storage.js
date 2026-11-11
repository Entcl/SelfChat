/**
 * 统一的异步存储服务 (SQLite 版本)
 * 底层通过 fetch 请求 Node 后端，存入 SQLite 数据库
 */

const isElectron = typeof window !== 'undefined' && window.electronAPI

// 内部通用请求方法
async function apiGet(key) {
  try {
    const res = await fetch(`/api/storage/${encodeURIComponent(key)}`)
    if (res.ok) {
      const data = await res.json()
      return data.value
    }
    return null
  } catch {
    return null
  }
}

async function apiSet(key, value) {
  try {
    const res = await fetch(`/api/storage/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: value === null ? null : String(value) })
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 👈 核心：数据迁移逻辑
 * 如果浏览器之前存了数据，启动时自动上传到 SQLite，并清空浏览器缓存
 */
export async function migrateLocalStorage() {
  const MIGRATED_FLAG = 'sc.migrated_to_sqlite'
  if (localStorage.getItem(MIGRATED_FLAG)) return

  console.log('[Storage] 检测到可能需要进行数据迁移...')
  let count = 0
  const keys = Object.keys(localStorage)
  
  for (const key of keys) {
    if (key.startsWith('sc.')) {
      const val = localStorage.getItem(key)
      if (val !== null) {
        const ok = await apiSet(key, val)
        if (ok) count++
      }
    }
  }

  localStorage.setItem(MIGRATED_FLAG, 'true')
  if (count > 0) {
    console.log(`[Storage] 成功将 ${count} 条本地数据迁移至 SQLite！`)
    // 迁移完成后，可以选择清空旧数据，防止占用空间
    // for (const key of keys) if (key.startsWith('sc.')) localStorage.removeItem(key)
  }
}

// ================= 对外暴露的方法 =================

export const storage = {
  async getItem(key) {
    if (isElectron) return await window.electronAPI.dbGet(key)
    return await apiGet(key)
  },
  async setItem(key, value) {
    if (isElectron) return await window.electronAPI.dbSet(key, value)
    return await apiSet(key, value)
  },
  async removeItem(key) {
    if (isElectron) return await window.electronAPI.dbSet(key, null)
    return await apiSet(key, null)
  }
}

export async function loadJSON(key, fallback = null) {
  const raw = await storage.getItem(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) ?? fallback
  } catch {
    return fallback
  }
}

export async function saveJSON(key, value) {
  return await storage.setItem(key, JSON.stringify(value))
}

export async function loadRaw(key, fallback = null) {
  const raw = await storage.getItem(key)
  return raw ?? fallback
}

export async function saveRaw(key, value) {
  return await storage.setItem(key, value)
}

export async function removeKey(key) {
  await storage.removeItem(key)
}