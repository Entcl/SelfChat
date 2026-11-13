import { computed, ref } from 'vue'
import { toast } from './toast'

export const plugins = ref([])
export const loading = ref(false)

// ============================================================
// EXE 插件（独立数据源，与上面的 JS 插件完全隔离）
// ============================================================
export const exePlugins = ref([])
export const exeLoading = ref(false)

/**
 * 前端兜底去重。
 *
 * 后端已经做过严格去重，但用户机器上可能残留旧版本的自定义插件目录，
 * 或者同时存在 userData 与内置目录两份数据。这里再按身份做一次去重，
 * 保证 UI 上绝对不会出现两张一模一样的卡片。
 *
 * @param {Array<object>} list
 * @param {(item: object) => string} identityFn 返回身份 key
 */
function dedupeBy(list, identityFn) {
  const seen = new Set()
  const out = []
  for (const item of list || []) {
    if (!item) continue
    const key = String(identityFn(item) || '').toLowerCase()
    if (!key) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** 普通插件的身份：优先用 id，退化到 name */
const jsIdentity = (p) => p.id || p.name || ''

/**
 * EXE 插件的身份：用 exe 文件名（去扩展名）作为身份，
 * 这样 `AdShield/AdShield.exe` 和 `adshield_exe/AdShield.exe` 会被识别成同一个。
 */
const exeIdentity = (p) => {
  const exe = String(p.exePath || '')
  if (exe) {
    const base = exe.replace(/\\/g, '/').split('/').pop() || ''
    const name = base.replace(/\.exe$/i, '')
    if (name) return name
  }
  return p.id || p.name || ''
}

export const jsPluginList = computed(() => dedupeBy(plugins.value, jsIdentity))
export const exePluginList = computed(() => dedupeBy(exePlugins.value, exeIdentity))

export async function fetchPlugins() {
  loading.value = true
  try {
    const res = await fetch('/api/plugins')
    if (res.ok) {
      const data = await res.json()
      plugins.value = dedupeBy(data.plugins || [], jsIdentity)
      
      if (data.errors && data.errors.length > 0) {
        toast.error(`插件加载失败: ${data.errors[0]}`)
      }
    }
  } catch (err) {
    console.error('拉取插件列表失败:', err)
  } finally {
    loading.value = false
  }
}

/**
 * 拉取 EXE 插件清单。
 * 与 fetchPlugins 是两个独立请求：后端已经做了分流，
 * 这里分开拉是为了两个 Tab 各自有独立的 loading 状态。
 */
export async function fetchExePlugins() {
  exeLoading.value = true
  try {
    const res = await fetch('/api/plugins/exe')
    if (res.ok) {
      const data = await res.json()
      // 兜底过滤：只保留目录版（有 exePath 且 layout 为 onedir），
      // 单文件形态即使后端漏了也不会显示出来
      const cleaned = (data.plugins || [])
        .filter(Boolean)
        .filter((p) => p.type === 'exe' && p.layout === 'onedir')
      exePlugins.value = dedupeBy(cleaned, exeIdentity)
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error || 'EXE 插件列表加载失败')
    }
  } catch (err) {
    console.error('拉取 EXE 插件列表失败:', err)
  } finally {
    exeLoading.value = false
  }
}

/** 启用/禁用 EXE 插件（写回 plugins_config.json） */
export async function toggleExePlugin(id, enabled) {
  const res = await fetch(`/api/plugins/exe/${encodeURIComponent(id)}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || '切换失败')

  const item = exePlugins.value.find((p) => p.id === id)
  if (item) item.enabled = Boolean(enabled)
  return true
}

export async function uploadPlugin(files) {
  const formData = new FormData()
  const paths = []
  
  files.forEach(file => {
    formData.append('files', file)
    paths.push(file.webkitRelativePath || file.name)
  })
  
  formData.append('pathsJson', JSON.stringify(paths))
  
  const res = await fetch('/api/plugins/upload-multi', {
    method: 'POST',
    body: formData
  })
  
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '上传失败')
  
  await fetchPlugins()
  return true
}

export async function togglePlugin(id, enabled) {
  try {
    await fetch(`/api/plugins/${id}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    })
    const p = plugins.value.find(x => x.id === id)
    if (p) p.enabled = enabled
  } catch (err) {
    console.error('切换插件状态失败:', err)
    throw err
  }
}

// 👈 新增：重命名插件
export async function renamePlugin(id, alias) {
  try {
    await fetch(`/api/plugins/${id}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias })
    })
    const p = plugins.value.find(x => x.id === id)
    if (p) p.alias = alias
  } catch (err) {
    console.error('重命名插件失败:', err)
    throw err
  }
}

export async function removePlugin(id) {
  try {
    const res = await fetch(`/api/plugins/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('删除失败')
    plugins.value = plugins.value.filter(x => x.id !== id)
  } catch (err) {
    console.error('删除插件失败:', err)
    throw err
  }
}