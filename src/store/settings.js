import { reactive, watch } from 'vue'
import { loadJSON, saveJSON } from '../utils/storage'

const STORAGE_KEY = 'sc.settings.v1'

export const API_PRESETS = [
  { 
    label: '本地 Ollama', 
    value: { protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' }, 
    models: ['qwen2.5:7b', 'qwen2.5:14b', 'qwen2.5-coder:7b', 'deepseek-r1:7b', 'deepseek-r1:14b'],
    hint: 'Ollama 直连' 
  },
  { 
    label: 'DeepSeek', 
    // 👈 这里改为 API 支持的准确名称
    value: { protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash' }, 
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    hint: '需填 API Key' 
  },
  { 
    label: 'Kimi', 
    value: { protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' }, 
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    hint: '需填 API Key' 
  },
  { 
    label: '智谱', 
    value: { protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4' }, 
    models: ['glm-4', 'glm-4-flash', 'glm-4v'],
    hint: '需填 API Key' 
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
}

export const settings = reactive({ ...DEFAULTS })
let isReady = false

export async function initSettings() {
  const saved = await loadJSON(STORAGE_KEY, {})
  if (saved && typeof saved === 'object') {
    Object.assign(settings, saved)
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