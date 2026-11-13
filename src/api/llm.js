/**
 * 模型接口适配层
 */
import { settings } from '../store/settings'

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0))

// 👈 新增：智能拼接请求地址，防止 /v1 重复
function buildEndpoint(baseUrl, path) {
  let base = String(baseUrl || '').trim().replace(/\/+$/, '')
  // 如果路径是 /v1/xxx，且 base 已经以 /v1 结尾，去掉多余的
  if (path.startsWith('/v1') && base.endsWith('/v1')) {
    return base + path.slice(3)
  }
  return base + path
}

function describeHttpError(status, detail, contentType = '') {
  let extra = ''
  if (/json/i.test(contentType)) {
    try {
      const parsed = JSON.parse(detail)
      const raw = parsed?.error?.message || parsed?.error || parsed?.message || ''
      extra = String(raw).trim().slice(0, 140)
    } catch {
      extra = ''
    }
  }
  let hint = ''
  if (status === 404) hint = '（接口不存在，请检查接口地址与协议）'
  else if (status === 401 || status === 403) hint = '（鉴权失败，请检查 API Key）'
  else if (status >= 500) hint = '（模型服务返回异常）'
  else if (status === 400) hint = '（请求被拒绝，请检查模型名称是否已下载）'
  return `请求失败 HTTP ${status}${hint}${extra ? `：${extra}` : ''}`
}

async function httpError(response) {
  const detail = await response.text().catch(() => '')
  return new Error(describeHttpError(response.status, detail, response.headers.get('content-type') || ''))
}

function friendlyNetworkError(error) {
  const message = String(error?.message || error || '')
  if (/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(message)) {
    const error = new Error('无法连接到模型服务：请检查接口地址或网络')
    error.offline = true
    return error
  }
  return error instanceof Error ? error : new Error(message || '未知错误')
}

// 当前页面是否运行在「非本机」环境（手机、平板等远程访问）
// 这类设备无法直连 127.0.0.1 的模型服务，必须由后端代理
function isRemoteClient() {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return !(h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]')
}

// 判断模型地址是否指向本机/内网（这类地址远程设备无法直连）
function isLocalTarget(baseUrl) {
  try {
    const raw = String(baseUrl || '').trim()
    if (!raw) return false
    // 相对路径（如 /api）本身就是走后端，不算本地直连
    if (raw.startsWith('/')) return false
    const host = new URL(raw).hostname
    return (
      host === '127.0.0.1' ||
      host === 'localhost' ||
      host === '::1' ||
      host === '[::1]' ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    )
  } catch {
    return false
  }
}

export async function listModels(customConfig) {
  const conf = customConfig || settings
  const openai = conf.protocol === 'openai'
  const endpoint = openai 
    ? buildEndpoint(conf.baseUrl, '/v1/models') 
    : buildEndpoint(conf.baseUrl, '/api/tags')
    
  const headers = { 'Content-Type': 'application/json' }
  if (conf.apiKey) headers.Authorization = `Bearer ${conf.apiKey}`

  let response
  try {
    // 两种情况走后端 /api/models 代理：
    // 1. 远程设备 + 本地模型地址（原有逻辑）
    // 2. 配置了网络代理 —— 浏览器 fetch 无法指定代理，必须由后端 axios 挂 Agent 转发
    const proxyUrl = String(conf.proxyUrl ?? settings.proxyUrl ?? '').trim()
    const viaBackend =
      /^https?:\/\//i.test(endpoint) &&
      (proxyUrl || (isRemoteClient() && isLocalTarget(conf.baseUrl)))
    if (viaBackend) {
      response = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl: endpoint, targetHeaders: headers, proxyUrl }),
      })
    } else {
      response = await fetch(endpoint, { headers })
    }
  } catch (error) {
    throw friendlyNetworkError(error)
  }
  if (!response.ok) throw await httpError(response)
  
  const data = await response.json().catch(() => null)
  if (!data) throw new Error('模型列表返回格式无法解析')

  if (openai) {
    return (data.data || []).map((item) => item?.id).filter(Boolean).sort()
  }
  return (data.models || []).map((item) => item?.name).filter(Boolean).sort()
}

export async function streamChat({ messages, signal, onDelta, sessionConfig }) {
  const activeSettings = sessionConfig 
    ? { ...settings, ...sessionConfig } 
    : settings

  const openai = activeSettings.protocol === 'openai'
  const temperature = clamp(activeSettings.temperature, 0, 2)
  // 👇 高级生成参数：流式开关（默认开）与最大输出 Token（0 = 不限制）
  const useStream = activeSettings.stream !== false
  const maxTokens = clamp(activeSettings.maxTokens, 0, 200000)
  const tokenLimit = maxTokens > 0 ? { max_tokens: maxTokens } : {}

  const finalUrl = openai 
    ? buildEndpoint(activeSettings.baseUrl, '/v1/chat/completions')
    : buildEndpoint(activeSettings.baseUrl, '/api/chat')

  const headers = { 'Content-Type': 'application/json' }
  if (activeSettings.apiKey) headers.Authorization = `Bearer ${activeSettings.apiKey}`

  // 两族协议的参数结构不同：OpenAI 用顶层字段，Ollama 用 options 包装
  // （Ollama 的输出上限字段是 num_predict）
  const payload = openai
    ? { model: activeSettings.model, messages, stream: useStream, temperature, ...tokenLimit }
    : {
        model: activeSettings.model,
        messages,
        stream: useStream,
        options: { temperature, ...(maxTokens > 0 ? { num_predict: maxTokens } : {}) },
      }

  const proxyPayload = {
    ...payload,
    targetUrl: finalUrl,
    targetHeaders: headers,
    // 网络代理是全局设置：由后端 axios 在转发时挂 HttpsProxyAgent
    proxyUrl: String(activeSettings.proxyUrl ?? '').trim(),
  }

  let response
  try {
    response = await fetch('/api/plugin-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proxyPayload),
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw friendlyNetworkError(error)
  }

  if (!response.ok) {
    throw await httpError(response)
  }

  // 👇 非流式模式：模型一次性返回完整 JSON（无 data: 前缀），不走下面的 SSE 行解析
  if (!useStream) {
    const data = await response.json().catch(() => null)
    if (!data) throw new Error('模型返回格式无法解析')
    if (data?.error) {
      const detail = typeof data.error === 'string' ? data.error : data.error?.message
      throw new Error(detail || '模型返回错误')
    }
    const content = openai ? data?.choices?.[0]?.message?.content : data?.message?.content
    if (typeof content === 'string' && content) onDelta(content)

    // 统计：OpenAI 兼容接口用 usage.completion_tokens，Ollama 用 eval_count
    const tokens = openai ? data?.usage?.completion_tokens : data?.eval_count
    const metrics = tokens ? { tokens: Number(tokens) || null, tps: null } : null
    return { stats: metrics }
  }

  if (!response.body) throw new Error('当前浏览器不支持流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let finished = false
  let metrics = null

  const handleLine = (rawLine) => {
    let line = String(rawLine).trim()
    if (!line || finished) return

    if (openai) {
      if (!line.startsWith('data:')) return
      line = line.slice(5).trim()
      if (!line) return
      if (line === '[DONE]') {
        finished = true
        return
      }
    }

    let data
    try {
      data = JSON.parse(line)
    } catch {
      return
    }

    if (data?.error) {
      const detail = typeof data.error === 'string' ? data.error : data.error?.message
      throw new Error(detail || '模型返回错误')
    }

    const delta = openai ? data?.choices?.[0]?.delta?.content : data?.message?.content
    if (typeof delta === 'string' && delta) onDelta(delta)

    if (!openai && data?.done && data?.eval_count) {
      const seconds = Number(data.eval_duration) / 1e9
      metrics = {
        tokens: Number(data.eval_count) || null,
        tps: seconds > 0 ? Math.round((Number(data.eval_count) / seconds) * 10) / 10 : null,
      }
    }
  }

  try {
    while (!finished) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
    }
    if (buffer.trim()) handleLine(buffer)
  } finally {
    try {
      reader.releaseLock()
    } catch {}
  }

  return { stats: metrics }
}