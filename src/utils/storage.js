/**
 * 统一的异步存储服务 (SQLite 版本)
 * 底层通过 fetch 请求 Node 后端，存入 SQLite 数据库
 *
 * ============ 多窗口隔离（工作区命名空间） ============
 * 每个 Electron 窗口对应一个「工作区」(w1 / w2 / ...)。
 * 所有对外暴露的 key 在这里统一加上 `<workspace>::` 前缀，
 * 因此 chat / user / settings / theme 全部自动按窗口隔离，
 * 上层 store 完全不需要感知窗口的存在。
 *
 * 浏览器环境下没有工作区概念，退化为 'w1'，行为与改造前一致。
 */

const WORKSPACE_RE = /^w\d+$/

/** 默认工作区：旧版裸 key 的归属者 */
const DEFAULT_WORKSPACE = 'w1'

/** 从 URL 查询参数里取工作区 id（主进程 loadURL 时注入，最可靠） */
function readWorkspaceFromUrl() {
  if (typeof window === 'undefined' || !window.location) return ''
  try {
    const raw = new URLSearchParams(window.location.search).get('sc-workspace')
    return typeof raw === 'string' && WORKSPACE_RE.test(raw) ? raw : ''
  } catch {
    return ''
  }
}

/** 从 Electron preload 注入的同步值里取工作区 id */
function readWorkspaceId() {
  if (typeof window === 'undefined') return ''
  // 优先级 1：URL 查询参数（同步、无 IPC、必然存在）
  const fromUrl = readWorkspaceFromUrl()
  if (fromUrl) return fromUrl
  // 优先级 2：preload 注入值（argv / sendSync 兜底）
  const raw = window.electronAPI?.workspaceId
  return typeof raw === 'string' && WORKSPACE_RE.test(raw) ? raw : ''
}

/** 当前窗口的工作区 id（'w1' / 'w2' / ...） */
export const workspaceId = readWorkspaceId() || DEFAULT_WORKSPACE

/** 是否运行在 Electron 里（有工作区概念） */
export const hasWorkspace = Boolean(readWorkspaceId())

const isElectron = typeof window !== 'undefined' && window.electronAPI

/** 给逻辑 key 加上工作区命名空间 */
export function nsKey(key) {
  return `${workspaceId}::${key}`
}

/** 改造前的老 key（无命名空间）—— 仅用于一次性迁移 */
const LEGACY_KEYS = [
  'sc.chat.v1',
  'sc.user.profile.v1',
  'sc.settings.v1',
  'sc.theme.v1',
]

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

// ================= 对外暴露的方法 =================

export const storage = {
  async getItem(key) {
    if (isElectron) return await window.electronAPI.dbGet(nsKey(key))
    return await apiGet(nsKey(key))
  },
  async setItem(key, value) {
    if (isElectron) return await window.electronAPI.dbSet(nsKey(key), value)
    return await apiSet(nsKey(key), value)
  },
  async removeItem(key) {
    if (isElectron) return await window.electronAPI.dbSet(nsKey(key), null)
    return await apiSet(nsKey(key), null)
  }
}

/** 直接按「已带命名空间」的完整 key 读写，供迁移逻辑使用 */
async function rawGet(fullKey) {
  if (isElectron) return await window.electronAPI.dbGet(fullKey)
  return await apiGet(fullKey)
}

async function rawSet(fullKey, value) {
  if (isElectron) return await window.electronAPI.dbSet(fullKey, value)
  return await apiSet(fullKey, value)
}

/**
 * 👈 核心：数据迁移逻辑（浏览器 localStorage → SQLite）
 * 如果浏览器之前存了数据，启动时自动上传到 SQLite，并清空浏览器缓存
 *
 * 注意：这里写入的是**带工作区命名空间**的 key，
 * 保证老用户升级后数据落在当前窗口的工作区里，而不是裸 key 上。
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
        const ok = await storage.setItem(key, val)
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

/**
 * 👈 核心：旧版「无命名空间 key」→ 默认工作区的一次性收编
 *
 * 改造前所有窗口共用 `sc.chat.v1` 这类裸 key。升级后如果直接改成
 * `w1::sc.chat.v1`，老用户会看到「历史记录全没了」——这是不可接受的。
 * 所以首个窗口启动时把裸 key 的值复制到自己的命名空间下。
 *
 * 只复制不删除：万一需要回滚旧版本，原数据仍然完好。
 *
 * ⚠️ 只在默认工作区 (w1) 执行。
 * 裸 key 是「多窗口时代之前的那一份数据」，它只属于一个工作区。
 * 如果 w2 也来收编，两个窗口就会看到同一份历史 —— 那正是要修的 bug。
 */
export async function adoptLegacyKeys() {
  if (!isElectron) return
  if (workspaceId !== DEFAULT_WORKSPACE) return
  for (const legacyKey of LEGACY_KEYS) {
    try {
      const scoped = nsKey(legacyKey)
      if (scoped === legacyKey) continue
      const already = await rawGet(scoped)
      if (already !== null && already !== undefined) continue // 本工作区已有数据，不覆盖
      const old = await rawGet(legacyKey)
      if (old === null || old === undefined) continue
      const ok = await rawSet(scoped, old)
      if (ok) console.log(`[Storage] 已把旧数据 ${legacyKey} 收编到工作区 ${workspaceId}`)
    } catch (err) {
      console.warn('[Storage] 收编旧数据失败:', legacyKey, err?.message)
    }
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
