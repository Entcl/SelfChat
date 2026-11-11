/** 通用格式化 / 剪贴板 / 下载工具。 */

export function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

const pad = (n) => String(n).padStart(2, '0')

export function formatClock(ts) {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDateTime(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 会话列表用的相对时间：刚刚 / 12 分钟前 / 3 小时前 / 昨天 / 10-24 */
export function formatRelative(ts) {
  if (!ts) return ''
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`

  const today = startOfDay(now)
  const day = startOfDay(ts)
  if (day === today) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (day === today - 86_400_000) return '昨天'
  if (day === today - 86_400_000 * 2) return '前天'

  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return sameYear ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 用首条用户消息生成会话标题 */
export function makeTitle(text, max = 22) {
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return '新对话'
  const chars = [...clean]
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : clean
}

export function countChars(text) {
  return [...String(text || '')].length
}

/** 粗估 token：中文按 1 字 ≈ 1 token，西文按 4 字符 ≈ 1 token */
export function estimateTokens(text) {
  const value = String(text || '')
  const cjk = (value.match(/[\u4e00-\u9fa5\u3040-\u30ff]/g) || []).length
  const rest = value.length - cjk
  return Math.max(1, Math.round(cjk + rest / 4))
}

/** 剪贴板：优先 Clipboard API，失败时回退到 execCommand */
export async function copyText(text) {
  const value = String(text ?? '')
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    /* 继续走回退方案 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 文件名安全化 */
export function safeFileName(name, fallback = 'chat') {
  const clean = String(name || '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return clean || fallback
}
