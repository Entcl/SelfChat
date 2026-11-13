import { computed, ref } from 'vue'
import { loadJSON, saveJSON } from '../utils/storage'
import { settings } from './settings'
import { activeSession } from './chat'

const STORAGE_KEY = 'sc.user.profile.v1'
const DEFAULT_AI_NAME = '大肥鱼'
const PROVIDER_TYPES = ['local', 'api']

/**
 * ============ 角色名的隔离维度 ============
 *
 * 「本地」和「云端」是两个完全不同的助手人格，名字必须各自独立：
 * 在本地把角色改名成「小黄鱼」，不应该让云端的「大肥鱼」也被覆盖。
 *
 * 因此 AI 角色（名字 + 头像）按 providerType 分别存放：
 *   roles.local = 本地 Ollama 用的角色
 *   roles.api   = 云端 OpenAI 兼容服务用的角色
 *
 * 用户自己的头像 (userAvatar) 仍然共享 —— 那是同一个操作者，
 * 分到两边反而会让用户每开一个窗口都要重设一次。
 */

/** 把任意输入收敛成 'local' / 'api'，非法值一律按 'local' 处理 */
export function normalizeProvider(provider) {
  return provider === 'api' ? 'api' : 'local'
}

/** 由 protocol 字符串推导服务类型 */
function protocolToProvider(protocol) {
  return protocol === 'openai' ? 'api' : 'local'
}

/**
 * 当前服务类型 —— 这是「名字/头像该落到哪一份 roles」的唯一判据。
 *
 * ⚠️ 关键修复点：必须**先看当前会话自己的 config.protocol**，再看全局 settings.protocol。
 *
 * 修复前只读全局 settings.protocol，而 SettingsPanel 在有活动会话时
 * 只把协议写进 session.config、不回写全局，导致 settings.protocol 永远停在
 * 'ollama' → 本函数恒返回 'local' → 本地和云端共用 roles.local → 名字互相污染。
 */
export const currentProviderType = computed(() => {
  const sessionProtocol = activeSession.value?.config?.protocol
  if (sessionProtocol) return protocolToProvider(sessionProtocol)
  return protocolToProvider(settings.protocol)
})

export const userAvatar = ref('')

/** 每个 providerType 各存一份 AI 角色 */
const roles = ref({
  local: { aiName: DEFAULT_AI_NAME, aiAvatar: '' },
  api: { aiName: DEFAULT_AI_NAME, aiAvatar: '' },
})

/** 当前服务类型的角色对象 */
const activeRole = computed(() => roles.value[currentProviderType.value])

/**
 * 按 provider 精确读取一份角色快照。
 *
 * 这是三处 UI 唯一允许的读取入口形态：
 *   getProfileByProvider('local').name
 *   getProfileByProvider('api').name
 *
 * 返回的是普通对象（每次调用新建），调用方不得缓存或改写它，
 * 改名一律走 updateName(provider, newName)。
 *
 * @param {'local'|'api'} provider
 * @returns {{ provider: 'local'|'api', name: string, avatar: string }}
 */
export function getProfileByProvider(provider) {
  const type = normalizeProvider(provider)
  const role = roles.value[type]
  return { provider: type, name: role.aiName, avatar: role.aiAvatar }
}

/**
 * AI 角色名：读取当前 providerType 那一份。
 *
 * 写入请优先用 updateName(provider, newName) —— 它允许显式指定 provider，
 * 不受「当前激活的是哪个会话」影响，便于设置页/其他入口精确改写。
 */
export const aiName = computed({
  get: () => activeRole.value.aiName,
  set: (val) => {
    updateName(currentProviderType.value, val)
  },
})

/** AI 头像：同上，按 providerType 隔离 */
export const aiAvatar = computed({
  get: () => activeRole.value.aiAvatar,
  set: (val) => {
    updateAvatar(currentProviderType.value, val)
  },
})

/**
 * 统一改名入口。
 *
 * 三处 UI（顶部角色栏 / 侧边栏 / 消息气泡）都从本 store 的 aiName 读取，
 * 这里改完 roles 后 Vue 的响应式会在同一 tick 内让三处同时刷新，
 * 任何一处都不得自己维护 name 状态。
 *
 * @param {'local'|'api'} provider 目标服务类型
 * @param {string} newName 新名字（空值回落到默认名）
 * @param {{ deferred?: boolean }} [opts] deferred=true 时落盘走防抖（逐键输入用）
 */
export function updateName(provider, newName, opts = {}) {
  const type = normalizeProvider(provider)
  const next = String(newName || '').trim() || DEFAULT_AI_NAME
  if (roles.value[type].aiName === next) return
  roles.value[type].aiName = next
  if (opts.deferred) persistSoon()
  else persist()
}

/**
 * 统一改头像入口，语义与 updateName 一致。
 * @param {'local'|'api'} provider 目标服务类型
 * @param {string} val 头像（data URI 或 URL），空值表示清除
 */
export function updateAvatar(provider, val) {
  const type = normalizeProvider(provider)
  const next = val || ''
  if (roles.value[type].aiAvatar === next) return
  roles.value[type].aiAvatar = next
  persist()
}

export async function initUserStore() {
  const saved = await loadJSON(STORAGE_KEY, {})
  if (saved.userAvatar) userAvatar.value = saved.userAvatar

  if (saved.roles) {
    // 新结构：分别恢复两套角色
    for (const type of PROVIDER_TYPES) {
      const role = saved.roles[type]
      if (!role) continue
      if (role.aiName) roles.value[type].aiName = role.aiName
      if (role.aiAvatar) roles.value[type].aiAvatar = role.aiAvatar
    }
  } else {
    // 旧结构（扁平字段）：只有一份角色，归给本地，云端保持默认。
    // 这样升级后不会出现「两边名字一样」的老问题。
    if (saved.aiName) roles.value.local.aiName = saved.aiName
    if (saved.aiAvatar) roles.value.local.aiAvatar = saved.aiAvatar
  }
}

async function persist() {
  await saveJSON(STORAGE_KEY, {
    userAvatar: userAvatar.value,
    // 不再写扁平的 aiName / aiAvatar，避免下次启动又被当成「两边共用」读回来
    roles: {
      local: { ...roles.value.local },
      api: { ...roles.value.api },
    },
  })
}

/**
 * 防抖持久化 —— 专供「输入框逐字符输入」的场景。
 *
 * profile blob 里带着 base64 头像。压缩管线（utils/image.js）上线前，
 * 实测这张图能到 2.2MB，设置页的 input 又是 @input 逐键触发的，
 * 打一个 8 字的名字就要往 SQLite 写 8 次 2.2MB（≈18MB 同步 IPC），界面会明显卡顿。
 *
 * 现在头像统一压到 128x128 JPEG(q=0.8)，单张 3~8KB，逐键写入已不再是负担；
 * 但防抖仍然保留 —— 少写几十次 SQLite 总归是好事，也顺便兜住老数据。
 * UI 状态始终逐键实时更新（响应式不受影响）。
 */
let persistTimer = null
function persistSoon() {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    persist()
  }, 300)
}

/** 立即冲刷未落盘的改动（关窗/切后台时调用，避免丢失最后几个字符） */
export function flushUserStore() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
    return persist()
  }
  return Promise.resolve()
}

export async function setUserAvatar(val) {
  userAvatar.value = val
  await persist()
}

export async function setAiAvatar(val) {
  updateAvatar(currentProviderType.value, val)
}

export async function setAiName(val) {
  updateName(currentProviderType.value, val)
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { flushUserStore() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushUserStore()
  })
}
