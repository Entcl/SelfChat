import { reactive, watch } from 'vue'
import { loadJSON, saveJSON } from '../utils/storage'

const STORAGE_KEY = 'sc.settings.v1'

/**
 * 模型模板预设：业务精简后只保留三族服务 + 默认项（默认项由 UI 层额外渲染）。
 *
 * 字段说明：
 * - value      ：设置面板「快捷预设」点击后填入的配置（DeepSeek 用 /v1 形式）
 * - headerValue：聊天头部「选择模型模板」下拉选中后填入的配置（DeepSeek 用裸域名形式）。
 *                两种写法最终请求地址相同 —— buildEndpoint() 会自动补 /v1/chat/completions，
 *                区分只是为了分别满足两处 UI 的展示文案要求。
 * - custom     ：标记「OpenAI 兼容」这类不预填地址、完全由用户自定义的预设，
 *                UI 据此给出「请填写 Base URL」的引导提示。
 */
export const API_PRESETS = [
  {
    label: '本地 Ollama',
    value: { protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' },
    models: ['qwen2.5:7b', 'qwen2.5:14b', 'qwen2.5-coder:7b', 'deepseek-r1:7b', 'deepseek-r1:14b'],
    hint: 'Ollama 直连',
  },
  {
    label: 'DeepSeek',
    value: { protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    headerValue: { protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
    models: ['deepseek-chat', 'deepseek-reasoner'],
    hint: '需填 API Key',
  },
  {
    label: 'OpenAI 兼容',
    value: { protocol: 'openai', baseUrl: '', model: '' },
    models: [],
    hint: '填入兼容服务的 Base URL',
    custom: true,
  },
]

const DEFAULTS = {
  protocol: 'ollama',
  baseUrl: '/api',
  apiKey: '',
  model: 'qwen2.5:7b',
  temperature: 0.7,
  contextRounds: 10,
  systemPrompt: '',
  models: [], 
  // 👇 网络代理：仅作用于发往模型服务的 https 请求（由后端 axios 挂代理 Agent），空串 = 不启用
  proxyUrl: '',
  // 👇 高级生成参数：最大输出 Token 上限，0 = 不限制
  maxTokens: 0,
  // 👇 流式输出开关：true = 逐字流式返回；false = 等待完整回复一次性显示
  stream: true,
}

export const settings = reactive({ ...DEFAULTS })
let isReady = false

export async function initSettings() {
  const saved = await loadJSON(STORAGE_KEY, {})
  if (saved && typeof saved === 'object') {
    // 先铺一遍 DEFAULTS 再覆盖已保存字段：
    // 老版本存储里没有 proxyUrl / maxTokens / stream，这样合并能保证新键一定有合法默认值
    Object.assign(settings, DEFAULTS, saved)
  }
  isReady = true
}

export function apiUrl(path) {
  const base = String(settings.baseUrl || '').trim().replace(/\/+$/, '')
  return `${base}${path}`
}

export function chatUrlPreview(config) {
  const conf = config || settings
  let base = String(conf.baseUrl || '').trim().replace(/\/+$/, '')
  
  if (conf.protocol === 'openai') {
    if (base.endsWith('/v1')) {
      return `${base}/chat/completions`
    }
    return `${base}/v1/chat/completions`
  }
  return `${base}/api/chat`
}

let saveTimer = null
watch(
  settings,
  () => {
    if (!isReady) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const { models, ...persisted } = settings
      saveJSON(STORAGE_KEY, persisted)
    }, 300)
  },
  { deep: true },
)

export function resetSettings() {
  Object.assign(settings, { ...DEFAULTS, models: settings.models })
}