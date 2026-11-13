import { computed, reactive } from 'vue'
import { listModels, streamChat } from '../api/llm'
import { makeTitle, uid } from '../utils/format'
import { loadJSON, saveJSON } from '../utils/storage'
import { settings } from './settings'
import { toast } from './toast'

const STORAGE_KEY = 'sc.chat.v1'
const MAX_SESSIONS = 80

const WELCOME = [
  '### 你好，我是大肥鱼 🐟',
  '',
  '本地模型已接入，随时可以开始。你可以直接：',
  '',
  '- **写代码**：描述需求，我来实现并讲解关键逻辑',
  '- **读文档**：贴一段文字，我帮你提炼要点与结论',
  '- **改文案**：把口语化的表达润色得更专业',
  '- **解释概念**：用类比把复杂原理讲明白',
  '',
  '> 小贴士：`Enter` 发送，`Shift + Enter` 换行；右上角可以切换当前对话的模型。',
].join('\n')

export const chat = reactive({
  sessions: [],
  activeId: null,
  streaming: false,
  status: 'idle',
  lastError: '',
})

/**
 * 会话列表的归属维度：当前窗口「主模式」是本地还是云端。
 *   'local' = 本地 Ollama，'api' = 云端 OpenAI 兼容服务。
 * 历史记录按这个维度分组 —— 本地列表看不到云端对话，反之亦然。
 *
 * ⚠️ 注意与 user.js 的 currentProviderType 区分，两者语义不同、不可合并：
 *
 *   - 本变量 (sessionListProviderType)：回答「这条会话该出现在哪个列表里」。
 *     必须只看全局 settings.protocol，因为它是**过滤条件本身**；
 *     若改成读「当前会话的 config.protocol」，过滤就会依赖被过滤对象而自指。
 *
 *   - user.js 的 currentProviderType：回答「这次改名该落到哪一份角色上」。
 *     必须优先看当前会话的 config.protocol，否则用户在云端会话里改名
 *     会写进本地角色，导致两边名字互相污染。
 *
 * 名字里带 List 就是为了让这个区别一眼可见。
 */
export const sessionListProviderType = computed(() => (settings.protocol === 'openai' ? 'api' : 'local'))

/** 只属于当前服务类型的历史对话。侧边栏与「当前会话」都以此为准。 */
export const visibleSessions = computed(() =>
  chat.sessions.filter((session) => (session.providerType || 'local') === sessionListProviderType.value),
)

export const activeSession = computed(
  () => visibleSessions.value.find((session) => session.id === chat.activeId) || null,
)

let controller = null
let saveTimer = null
let quotaWarned = false

function serializeSession(session) {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    pinned: Boolean(session.pinned),
    providerType: session.providerType === 'api' ? 'api' : 'local',
    config: session.config || null,
    messages: session.messages.map((message) => {
      const { streaming, ...rest } = message
      return rest
    }),
  }
}

async function persist() {
  clearTimeout(saveTimer)
  saveTimer = null
  
  const ok = await saveJSON(STORAGE_KEY, {
    activeId: chat.activeId,
    sessions: chat.sessions.map(serializeSession),
  })
  
  if (!ok && !quotaWarned) {
    quotaWarned = true
    toast.error('本地存储空间不足，历史记录可能无法保存')
  }
  return ok
}

function persistSoon() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    persist().catch(console.error)
  }, 350)
}

function normalizeSession(raw) {
  return {
    id: raw?.id || uid(),
    title: raw?.title || '新对话',
    createdAt: raw?.createdAt || Date.now(),
    updatedAt: raw?.updatedAt || raw?.createdAt || Date.now(),
    pinned: Boolean(raw?.pinned),
    // 历史数据没有这个字段：一律视为本地对话，避免老记录在云端窗口里「复活」
    providerType: raw?.providerType === 'api' ? 'api' : 'local',
    config: raw?.config || null,
    messages: Array.isArray(raw?.messages)
      ? raw.messages
          .filter((message) => message && typeof message.content === 'string')
          .map((message) => ({
            id: message.id || uid(),
            role: message.role === 'user' ? 'user' : 'assistant',
            content: message.content,
            createdAt: message.createdAt || Date.now(),
            model: message.model,
            error: message.error,
            aborted: message.aborted,
            welcome: message.welcome,
            stats: message.stats,
            edited: message.edited,
          }))
      : [],
  }
}

function pruneSessions() {
  if (chat.sessions.length <= MAX_SESSIONS) return
  const sorted = [...chat.sessions].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  chat.sessions = sorted.slice(0, MAX_SESSIONS)
  if (!chat.sessions.some((session) => session.id === chat.activeId)) {
    chat.activeId = chat.sessions[0]?.id ?? null
  }
}

export function createSession({ greeting = false, activate = true, silent = false } = {}) {
  // 只在「同一服务类型」的空对话里复用，避免本地窗口把云端空会话顶掉
  const existingEmpty = chat.sessions.find(
    (s) =>
      (s.providerType || 'local') === sessionListProviderType.value &&
      (s.title === '新对话' || !s.title) &&
      s.messages.length === 0,
  )

  if (existingEmpty) {
    if (activate) {
      chat.activeId = existingEmpty.id
      if (!silent) {
        toast.info('已有空的新对话，已为您切换')
      }
    }
    return existingEmpty
  }

  const now = Date.now()
  const session = {
    id: uid(),
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    pinned: false,
    // 👈 打上归属标记：此后它只会出现在同一服务类型的窗口/模式里
    providerType: sessionListProviderType.value,
    config: null,
    messages: [],
  }

  if (greeting) {
    session.messages.push({
      id: uid(),
      role: 'assistant',
      content: WELCOME,
      createdAt: now,
      welcome: true,
    })
  }

  chat.sessions.unshift(session)
  pruneSessions()
  if (activate) chat.activeId = session.id
  persistSoon()
  return session
}

export function updateSessionConfig(id, config) {
  const session = chat.sessions.find(s => s.id === id)
  if (session) {
    session.config = config
    session.updatedAt = Date.now()
    persistSoon()
  }
}

export function selectSession(id) {
  if (!chat.sessions.some((session) => session.id === id)) return
  chat.activeId = id
  persistSoon()
}

export function deleteSession(id) {
  const index = chat.sessions.findIndex((session) => session.id === id)
  if (index < 0) return
  if (chat.streaming && chat.activeId === id) stop()
  chat.sessions.splice(index, 1)
  if (chat.activeId === id) {
    // 下一个激活项必须同属当前服务类型，否则会「跳到」另一侧的历史里
    const sameType = chat.sessions.filter(
      (session) => (session.providerType || 'local') === sessionListProviderType.value,
    )
    chat.activeId = sameType[0]?.id ?? null
    if (!chat.activeId) createSession({ greeting: false, silent: true })
  }
  persistSoon()
}

export function renameSession(id, title) {
  const session = chat.sessions.find((item) => item.id === id)
  if (!session) return
  const next = String(title || '').trim()
  session.title = next || '新对话'
  session.updatedAt = Date.now()
  persistSoon()
}

export function togglePin(id) {
  const session = chat.sessions.find((item) => item.id === id)
  if (!session) return
  session.pinned = !session.pinned
  persistSoon()
}

export function clearMessages() {
  const session = activeSession.value
  if (!session || chat.streaming) return
  session.messages = []
  session.title = '新对话'
  session.updatedAt = Date.now()
  persistSoon()
}

export function deleteMessage(id) {
  const session = activeSession.value
  if (!session || chat.streaming) return
  const index = session.messages.findIndex((message) => message.id === id)
  if (index > -1) {
    session.messages.splice(index, 1)
    persistSoon()
  }
}

export function clearAll() {
  if (chat.streaming) stop()
  // 👈 只清空「当前服务类型」的历史：本地窗口点清空，不该顺手删掉云端对话
  const keep = chat.sessions.filter((session) => (session.providerType || 'local') !== sessionListProviderType.value)
  chat.sessions = keep
  chat.activeId = null
  createSession({ greeting: true, silent: true })
}

function buildPayload(session) {
  const limit = Math.max(2, Number(settings.contextRounds) * 2)
  const history = session.messages
    .filter((message) => !message.error && !message.welcome && message.content.trim())
    .slice(-limit)

  const payload = []
  const systemPrompt = String(settings.systemPrompt || '').trim()
  if (systemPrompt) payload.push({ role: 'system', content: systemPrompt })
  history.forEach((message) => payload.push({ role: message.role, content: message.content }))
  return payload
}

async function runCompletion() {
  // 👈 GitHub Pages 环境拦截：如果有人在前端预览版里发消息，直接假回复
  if (window.location.hostname.includes('github.io')) {
    const session = activeSession.value
    if (!session || chat.streaming) return

    chat.streaming = true
    const mockId = uid()
    session.messages.push({
      id: mockId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      model: 'preview-mode',
      streaming: true,
    })
    
    const assistant = session.messages[session.messages.length - 1]
    setTimeout(() => {
      assistant.content = '🚧 抱歉，当前处于 GitHub Pages **纯前端预览模式**。\n\n由于没有连接本地的 Node.js 后端和 Ollama 模型，我无法给你真实的回复。\n\n如需完整对话体验，请将项目克隆到本地，并运行 `node server/index.js` 启动后端。'
      assistant.streaming = false
      chat.streaming = false
    }, 800)
    return
  }

  const session = activeSession.value
  if (!session || chat.streaming) return

  const payload = buildPayload(session)
  if (!payload.some((item) => item.role === 'user')) return

  session.messages.push({
    id: uid(),
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    model: session.config?.model || settings.model,
    streaming: true,
  })
  const assistant = session.messages[session.messages.length - 1]

  const abortController = new AbortController()
  controller = abortController

  chat.streaming = true
  chat.status = 'streaming'
  chat.lastError = ''
  const startedAt = performance.now()

  try {
    const result = await streamChat({
      messages: payload,
      signal: abortController.signal,
      sessionConfig: session.config,
      onDelta(delta) {
        assistant.content += delta
      },
    })

    const elapsed = Math.round(performance.now() - startedAt)
    assistant.stats = {
      ms: elapsed,
      tokens: result?.stats?.tokens ?? null,
      tps: result?.stats?.tps ?? null,
    }
    chat.status = 'online'
  } catch (error) {
    if (error?.name === 'AbortError' || abortController.signal.aborted) {
      assistant.aborted = true
      chat.status = 'online'
      if (!assistant.content.trim()) assistant.content = ''
    } else {
      const message = error?.message || '连接模型失败'
      assistant.error = message
      chat.lastError = message
      chat.status = 'offline'
    }
  } finally {
    assistant.streaming = false
    chat.streaming = false
    controller = null
    if (!assistant.content.trim() && !assistant.error && !assistant.aborted) {
      assistant.error = '模型没有返回内容，请重试'
    }
    session.updatedAt = Date.now()
    await persist()
  }
}

export async function send(text) {
  const session = activeSession.value
  const content = String(text || '').trim()
  if (!session || !content || chat.streaming) return

  if (!session.messages.some((message) => message.role === 'user')) {
    session.title = makeTitle(content)
  }

  session.messages.push({
    id: uid(),
    role: 'user',
    content,
    createdAt: Date.now(),
  })
  session.updatedAt = Date.now()
  await runCompletion()
}

export function stop() {
  controller?.abort()
}

export async function regenerate() {
  const session = activeSession.value
  if (!session || chat.streaming) return
  while (session.messages.length && session.messages[session.messages.length - 1].role === 'assistant') {
    session.messages.pop()
  }
  if (!session.messages.some((message) => message.role === 'user')) return
  await runCompletion()
}

export async function retry() {
  const session = activeSession.value
  if (!session || chat.streaming) return
  const last = session.messages[session.messages.length - 1]
  if (last?.role === 'assistant' && (last.error || !last.content.trim())) {
    session.messages.pop()
  }
  await runCompletion()
}

export async function editMessage(id, content) {
  const session = activeSession.value
  const next = String(content || '').trim()
  if (!session || chat.streaming || !next) return
  const index = session.messages.findIndex((message) => message.id === id)
  if (index < 0) return

  session.messages[index].content = next
  session.messages[index].edited = true
  session.messages.splice(index + 1)
  session.updatedAt = Date.now()
  await runCompletion()
}

export async function checkStatus(customConfig) {
  // 👈 GitHub Pages 环境拦截：不发起网络请求，直接返回离线
  if (window.location.hostname.includes('github.io')) {
    return { ok: false, error: new Error('预览环境不提供模型连接') }
  }

  try {
    const models = await listModels(customConfig)
    if (!customConfig) {
      settings.models = models
    }
    if (!chat.streaming) chat.status = 'online'
    return { ok: true, models }
  } catch (error) {
    if (!chat.streaming) chat.status = 'offline'
    return { ok: false, error }
  }
}

export async function initChatStore() {
  // 👈 GitHub Pages 环境拦截：注入首页假数据和对话
  if (window.location.hostname.includes('github.io')) {
    chat.sessions = [
      {
        id: 'mock-1',
        title: '前端 UI 预览版',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: true,
        config: null,
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: '你好，这个页面是怎么运行的？',
            createdAt: Date.now() - 10000,
          },
          {
            id: 'm2',
            role: 'assistant',
            content: '### 欢迎体验大肥鱼 🐟\n\n这是部署在 **GitHub Pages** 上的纯前端静态预览版。\n\n由于这里没有 Node.js 后端环境，也没有本地的大模型（如 Ollama），所以在此页面上发送消息不会收到真实的 AI 回复。\n\n不过你可以随意点开**设置面板**、切换**主题**、或者体验一下界面的**玻璃拟态动画**。\n\n> 想体验完整功能？请克隆项目到本地并运行 `node server/index.js` 启动后端！',
            createdAt: Date.now(),
          }
        ]
      },
      {
        id: 'mock-2',
        title: '这是一个历史对话',
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now() - 86400000,
        pinned: false,
        config: null,
        messages: [
          { id: 'm3', role: 'user', content: '测试一下侧边栏。', createdAt: Date.now() - 86400000 },
          { id: 'm4', role: 'assistant', content: '侧边栏的样式非常完美！', createdAt: Date.now() - 86400000 }
        ]
      }
    ]
    chat.activeId = 'mock-1'
    return
  }

  // 真实的本地环境加载逻辑
  const saved = await loadJSON(STORAGE_KEY, null)
  if (saved && Array.isArray(saved.sessions) && saved.sessions.length) {
    chat.sessions = saved.sessions.map(normalizeSession)
    // 👈 激活项必须是「当前服务类型」的会话；
    //    否则从云端切回本地时，会把云端对话当成当前会话继续往下写。
    const mine = chat.sessions.filter(
      (session) => (session.providerType || 'local') === sessionListProviderType.value,
    )
    const target = mine.find((session) => session.id === saved.activeId) || mine[0]
    if (target) {
      chat.activeId = target.id
    } else {
      // 当前服务类型下没有任何历史 → 新建一个空会话（不欢迎语，避免和另一侧重复）
      createSession({ greeting: true, silent: true })
    }
  } else {
    createSession({ greeting: true, silent: true })
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { persist() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist()
  })
}