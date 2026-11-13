/**
 * AdShield 插件适配层
 * ============================================================
 * 架构：Vue → POST /api/local-python/search → Node spawn(AdShield.exe, [keyword])
 *
 * 没有常驻服务、没有端口、没有跨域。exe 只在请求时启动，用完即退。
 * 这里把 Node 侧的错误码翻译成人话，页面只管展示 message。
 * ============================================================
 */

/**
 * 把 fetch 抛出的网络错误（TypeError: Failed to fetch）翻译成可读文案。
 * 这类错误发生在 Node 服务没起来的时候，浏览器只知道"请求没发出去"。
 */
function friendlyNetworkError(error) {
  const message = String(error?.message || '')
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return new Error('无法连接本地后端服务，请确认 SelfChat 主程序已启动')
  }
  if (error?.name === 'AbortError') return error
  return new Error(`请求失败：${message || '未知错误'}`)
}

/**
 * 从后端响应里提取错误文案。
 * Node 路由统一返回 { error, code }，这里兼容一下可能的其它形状。
 */
async function extractError(response) {
  let payload = null
  try {
    payload = await response.json()
  } catch {
    // 非 JSON 响应（比如 Express 默认的 HTML 404 页）
  }
  if (payload) {
    const detail = payload.error || payload.detail || payload.message
    if (typeof detail === 'string' && detail.trim()) {
      return { message: detail.trim(), code: payload.code || '' }
    }
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0]?.msg || JSON.stringify(detail[0])
      return { message: String(first), code: payload.code || 'VALIDATION_ERROR' }
    }
  }
  return { message: `服务返回 HTTP ${response.status}`, code: '' }
}

/**
 * 探测插件是否就绪。
 * 后端现在只做文件存在性检查，不启动任何进程，所以这个接口非常快。
 *
 * 永不抛错：结果收敛成 { alive, degraded, message, plugin }，页面直接绑到状态灯上。
 *
 * 三态说明：
 *   alive=true                  → 绿点「插件已就绪」
 *   alive=false, degraded=true  → 黄点「插件已损坏」（文件在但大小为 0）
 *   alive=false, degraded=false → 红点「插件未找到，请重新安装」
 */
export async function checkPythonHealth({ signal } = {}) {
  try {
    const response = await fetch('/api/local-python/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    })

    // 后端约定 health 恒返回 200（除了真崩了），用 body 里的字段判断状态
    const data = await response.json().catch(() => null)

    if (!response.ok || !data) {
      const message = data
        ? (data.error || '插件状态未知')
        : `服务返回 HTTP ${response.status}`
      return { alive: false, degraded: false, message, plugin: null }
    }

    // 安装损坏：文件存在但 0 字节
    if (data.code === 'PLUGIN_EMPTY') {
      return {
        alive: false,
        degraded: true,
        message: data.error || '插件文件已损坏（大小为 0），请重新安装',
        plugin: data.plugin || null,
      }
    }

    // 文件不存在
    if (!data.reachable || !data.plugin?.found) {
      return {
        alive: false,
        degraded: false,
        message: data.error || '插件未找到，请重新安装',
        plugin: data.plugin || null,
      }
    }

    return {
      alive: true,
      degraded: false,
      message: '插件已就绪',
      plugin: data.plugin,
    }
  } catch (error) {
    const friendly = friendlyNetworkError(error)
    return {
      alive: false,
      degraded: false,
      message: friendly.message,
      plugin: null,
    }
  }
}

/**
 * 生成激活码（调用本地 exe）。
 * @param {string} keyword 设备 ID（可带 ",时间戳" 后缀）
 * @returns {Promise<{ ok: boolean, keyword: string, result: string, elapsedMs: number, truncated: boolean }>}
 * @throws {Error} 失败时抛出，message 已经是可直接展示的中文，err.code 带后端错误码
 */
export async function generateActivationCode(keyword, { signal } = {}) {
  const trimmed = String(keyword || '').trim()
  if (!trimmed) throw new Error('请输入设备 ID')

  let response
  try {
    response = await fetch('/api/local-python/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: trimmed }),
      signal,
    })
  } catch (error) {
    throw friendlyNetworkError(error)
  }

  if (!response.ok) {
    const { message, code } = await extractError(response)
    const err = new Error(message)
    // 把后端 code 挂上去，页面可以据此决定要不要刷红状态灯
    // 可能的值：PLUGIN_NOT_FOUND / PLUGIN_EMPTY / PLUGIN_TIMEOUT /
    //          PLUGIN_SPAWN_FAILED / PLUGIN_EXIT_NONZERO / PLUGIN_EMPTY_OUTPUT
    err.code = code
    throw err
  }

  const data = await response.json().catch(() => null)
  if (!data || typeof data.result !== 'string') {
    throw new Error('插件返回格式无法解析')
  }

  return {
    ok: data.ok !== false,
    keyword: data.keyword || trimmed,
    result: data.result,
    elapsedMs: Number(data.elapsed_ms) || 0,
    truncated: Boolean(data.truncated),
  }
}

/** 插件相关的错误码集合，供组件判断是否该把状态灯刷红/刷黄 */
export const PLUGIN_ERROR_CODES = Object.freeze([
  'PLUGIN_NOT_FOUND',
  'PLUGIN_EMPTY',
  'PLUGIN_SPAWN_FAILED',
  'PLUGIN_TIMEOUT',
  'PLUGIN_OUTPUT_TOO_LARGE',
  'PLUGIN_EXIT_NONZERO',
  'PLUGIN_EMPTY_OUTPUT',
])
