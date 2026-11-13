<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import MarkdownBody from './MarkdownBody.vue'
import { chat, checkStatus, clearAll, activeSession, updateSessionConfig } from '../store/chat'
import { askConfirm } from '../store/confirm'
import { chatUrlPreview, resetSettings, settings, API_PRESETS } from '../store/settings'
import { resolvedTheme, setTheme, theme } from '../store/theme'
import { closeSettings } from '../store/ui'
import { toast } from '../store/toast'
import { userAvatar, aiAvatar, aiName, currentProviderType, updateName, updateAvatar, getProfileByProvider, setUserAvatar } from '../store/user'
import { exportAllSessions } from '../utils/export'
import { fileToAvatarDataUrl, AvatarError } from '../utils/image'
import defaultUserAvatar from '../assets/batman.svg'
import AiAvatar from './AiAvatar.vue'
import { plugins, jsPluginList, fetchPlugins, uploadPlugin, togglePlugin, removePlugin, renamePlugin, exePlugins, exePluginList, exeLoading, fetchExePlugins, toggleExePlugin } from '../store/plugins'
import ExePluginCard from './ExePluginCard.vue'
import { checkPythonHealth } from '../api/localPython'
import { openAdShield, ui } from '../store/ui'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const activeTab = ref('basic')
// 👈 插件管理下的二级 Tab：'js' 普通插件 / 'exe' 可执行插件
const pluginTab = ref('js')

/* ── 「聚焦 API Key」联动 ────────────────────────────────────
 * 顶部下拉选中 DeepSeek / OpenAI 兼容时，ui.apiKeyFocus 自增，
 * 这里负责：切到基础设置 Tab → 等 DOM/动画就绪 → 聚焦 + 高亮提示。
 */
const apiKeyRef = ref(null)
const apiKeyHint = ref(false)
let apiKeyTimer = null
/**
 * 程序性聚焦标志。
 *
 * el.focus() 会同步触发 @focus 事件，如果不拦住，
 * 下面刚点亮的高亮会被 clearApiKeyHint 立刻清掉（白闪一下）。
 * 所以程序聚焦前置位，事件回调里看到标志就跳过清理。
 */
let programmaticFocus = false

function clearApiKeyHint() {
  apiKeyHint.value = false
  if (apiKeyTimer) {
    clearTimeout(apiKeyTimer)
    apiKeyTimer = null
  }
}

/** 用户手动聚焦到输入框时，撤掉提示（但程序聚焦不算） */
function onApiKeyFocus() {
  if (programmaticFocus) return
  clearApiKeyHint()
}

/** 输入框一旦被用户操作，立刻撤掉高亮，避免一直亮着 */
function onApiKeyInput(e) {
  currentConfig.value = { ...currentConfig.value, apiKey: e.target.value }
  clearApiKeyHint()
}

/** 当前服务名，用于「在这里填入 XX 的 API Key」提示 */
const presetDisplayName = computed(() => {
  const url = currentConfig.value.baseUrl || ''
  const matched = API_PRESETS.find(
    (p) => p.value?.baseUrl === url || p.headerValue?.baseUrl === url,
  )
  if (matched) return matched.label
  return currentConfig.value.protocol === 'openai' ? '云端服务' : '本地服务'
})

watch(
  () => ui.apiKeyFocus,
  async (token) => {
    // 只看令牌：令牌自增就代表调用方明确要求聚焦。
    // 不在这里判断 props.open —— 父组件重渲染与子组件 watcher 的先后顺序
    // 依赖调度细节，卡在这里可能直接吞掉整次请求。
    if (!token) return

    // 1. 确保停在「基础设置」Tab —— 输入框在 v-show 的另一个 Tab 里时无法聚焦
    activeTab.value = 'basic'

    // 2. 等一帧让 Tab 切换和面板过渡开始
    await nextTick()

    // 3. 面板入场动画是 opacity 0.22s + transform 0.28s，
    //    在 transform 还没结束时 focus 会被浏览器的「滚动到可见」打断，
    //    所以等满 0.28s（取 300ms 留余量）再聚焦。
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (!props.open) return

    // 输入框可能还没挂载（面板刚从 display:none 出来），再等一帧
    await nextTick()
    let el = apiKeyRef.value
    if (!el) {
      // 最后再兜一次：某些情况下过渡结束比 220ms 略晚
      await new Promise((resolve) => setTimeout(resolve, 160))
      if (!props.open) return
      el = apiKeyRef.value
    }
    if (!el) return

    // 先点亮高亮，再聚焦：顺序反过来会因为 focus 同步触发而闪一下
    apiKeyHint.value = true

    programmaticFocus = true
    try {
      el.focus()
      // 聚焦后把光标放到末尾，而不是全选（用户可能是来补后半段）
      const len = el.value?.length ?? 0
      try {
        el.setSelectionRange(len, len)
      } catch {
        // type=password 在部分环境不支持 setSelectionRange，忽略即可
      }
    } finally {
      programmaticFocus = false
    }

    // 高亮脉冲：2.4s 后自动熄灭
    if (apiKeyTimer) clearTimeout(apiKeyTimer)
    apiKeyTimer = setTimeout(() => {
      apiKeyHint.value = false
      apiKeyTimer = null
    }, 2400)
  },
)

onBeforeUnmount(clearApiKeyHint)

const testing = ref(false)
const testResult = ref(null)
const refreshing = ref(false)
const showModelDropdown = ref(false)
const isRefreshingPlugins = ref(false)

// EXE 插件健康状态：与 AdShield 面板共用同一个探测接口
const exeHealth = ref('checking')
const exeHealthDetail = ref('')
const togglingExeId = ref('')

// 👈 失焦自动拉取的 loading 状态：防止用户来回切换焦点时重复发起请求
const isFetching = ref(false)

// 👈 插件重命名状态
const editingPluginId = ref(null)
const editingPluginAlias = ref('')
const pluginEditRef = ref(null)

const fetchedModels = ref([])
const isSessionOverride = computed(() => !!activeSession.value?.config)

// 👈 高级生成参数折叠面板的展开状态（默认收起，避免设置面板过长）
const advancedOpen = ref(false)

// 无活动对话时的兜底：让设置面板的修改仍能写回全局 settings，
// 否则自动拉取选中的模型会「看起来没生效」。
function commitConfig(next) {
  if (activeSession.value) {
    updateSessionConfig(activeSession.value.id, next)
    testResult.value = null
    return
  }
  settings.protocol = next.protocol
  settings.baseUrl = next.baseUrl
  settings.apiKey = next.apiKey
  settings.model = next.model
}

const currentConfig = computed({
  get: () => {
    return activeSession.value?.config || {
      protocol: settings.protocol,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
    }
  },
  set: (val) => commitConfig(val)
})

function onClose() {
  if (activeSession.value) {
    updateSessionConfig(activeSession.value.id, { ...currentConfig.value })
  }
  clearApiKeyHint()
  closeSettings()
}

function setProtocol(val) {
  currentConfig.value = { ...currentConfig.value, protocol: val }
  fetchedModels.value = []
}

function setBaseUrl(e) {
  currentConfig.value = { ...currentConfig.value, baseUrl: e.target.value }
  fetchedModels.value = []
}

async function silentFetchModels() {
  const config = currentConfig.value
  const result = await checkStatus(config)
  if (result.ok && result.models && result.models.length > 0) {
    fetchedModels.value = result.models
    if (!result.models.includes(config.model)) {
      currentConfig.value = { ...config, model: result.models[0] }
    }
  }
}

const availableModels = computed(() => {
  if (fetchedModels.value.length > 0) return fetchedModels.value 
  const isCloud = currentConfig.value.protocol === 'openai'
  const currentUrl = currentConfig.value.baseUrl
  if (!isCloud) {
    const localPreset = API_PRESETS.find(p => p.label === '本地 Ollama')?.models || []
    return Array.from(new Set([...(settings.models || []), ...localPreset])).filter(Boolean)
  }
  // 同一预设可能以 value / headerValue 两种 baseUrl 形式存在，都要能命中
  const matchedPreset = API_PRESETS.find(p =>
    [p.value, p.headerValue].filter(Boolean).some(v => v.baseUrl === currentUrl)
  )
  return matchedPreset?.models || ['deepseek-chat', 'deepseek-reasoner']
})

function usePreset(preset) {
  if (!preset.value) return
  fetchedModels.value = []
  // 快捷预设统一使用 value 形式的 baseUrl（DeepSeek 为 https://api.deepseek.com/v1）
  const target = preset.value
  let newKey = currentConfig.value.apiKey
  if (target.protocol === 'ollama') newKey = ''
  else if (currentConfig.value.baseUrl !== target.baseUrl) newKey = ''
  // 联动：protocol 写入后，下方「Ollama 原生 / OpenAI 兼容」切换 Tab 自动选中对应项
  currentConfig.value = {
    ...currentConfig.value,
    protocol: target.protocol,
    baseUrl: target.baseUrl,
    model: target.model,
    apiKey: newKey,
  }
  toast.success(`已切换至: ${preset.label}`)
  if (preset.custom) {
    // 「OpenAI 兼容」不预填地址，引导用户手动填写
    setTimeout(() => toast.info('请在下方填入兼容服务的 Base URL 与模型名称'), 300)
  } else if (target.protocol === 'openai' && !newKey) {
    setTimeout(() => toast.info('请在下方 API Key 输入框中填入你的密钥'), 300)
  }
}

function selectModel(name) {
  currentConfig.value = { ...currentConfig.value, model: name }
  showModelDropdown.value = false
}

function onModelInputBlur() {
  setTimeout(() => { showModelDropdown.value = false }, 150)
}

watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    fetchedModels.value = [] 
    await silentFetchModels()
    if (!testing.value) {
      checkStatus().then(res => { if (res.ok && !chat.streaming) chat.status = 'online' })
    }
    fetchPlugins() 
    // EXE 插件独立数据源，顺带把健康状态也探一次
    fetchExePlugins()
    refreshExeHealth()
  }
})

// ================= EXE 插件 =================

/** 探测 EXE 插件健康状态（文件存在 / 大小 / 布局） */
async function refreshExeHealth() {
  const result = await checkPythonHealth()
  if (result.alive) exeHealth.value = 'alive'
  else if (result.degraded) exeHealth.value = 'degraded'
  else exeHealth.value = 'down'
  exeHealthDetail.value = result.message || ''
}

async function onToggleExePlugin({ plugin, enabled }) {
  if (togglingExeId.value) return
  togglingExeId.value = plugin.id
  try {
    await toggleExePlugin(plugin.id, enabled)
    toast.success(enabled ? `${plugin.displayName} 已启用` : `${plugin.displayName} 已禁用`)
  } catch (err) {
    toast.error(err.message || '切换失败')
    // 回滚 UI：重新拉一次以服务端为准
    await fetchExePlugins()
  } finally {
    togglingExeId.value = ''
  }
}

/** 打开 AdShield 操作控制台（叠在设置面板之上） */
function onOpenExePlugin(plugin) {
  if (!plugin.enabled) {
    toast.info('请先启用该插件')
    return
  }
  // 目前只有一个 EXE 插件（AdShield），按 exe 文件名分流；
  // 将来接第二个插件时在这里加分支即可。
  if (/adshield/i.test(plugin.name) || /adshield/i.test(plugin.exePath || '')) {
    openAdShield(plugin.id)
  } else {
    toast.info(`「${plugin.displayName}」暂无可视化控制台`)
  }
}

async function handleRefreshExePlugins() {
  if (exeLoading.value) return
  await Promise.all([fetchExePlugins(), refreshExeHealth()])
  toast.success('已刷新 EXE 插件列表')
}

const userInput = ref(null)
const aiInput = ref(null)

function triggerUpload(type) {
  if (type === 'user') userInput.value?.click()
  else aiInput.value?.click()
}

async function handleFileChange(e, type) {
  const file = e.target.files?.[0]
  // 先清空，否则连续选同一张图不会再触发 change
  e.target.value = ''
  if (!file) return
  try {
    // 统一压缩：128x128 JPEG，避免几 MB 原图撑爆 profile blob
    const { dataUrl } = await fileToAvatarDataUrl(file)
    if (type === 'user') await setUserAvatar(dataUrl)
    else updateAvatar(currentProviderType.value, dataUrl)
    toast.success('头像已更新')
  } catch (err) {
    toast.error(err instanceof AvatarError ? err.message : '头像处理失败，请换一张试试')
  }
}

function resetUserAvatar() { setUserAvatar(''); toast.success('已恢复默认用户头像') }
function resetAiAvatar() { updateAvatar(currentProviderType.value, ''); toast.success('已恢复默认 AI 头像') }

// ================= 插件相关 =================
const pluginInput = ref(null)
const pluginFolderInput = ref(null)

function triggerPluginUpload() { pluginInput.value?.click() }
function triggerFolderUpload() { pluginFolderInput.value?.click() }

async function handlePluginFile(e) {
  const file = e.target.files[0]
  if (!file) return
  if (!file.name.endsWith('.js')) return toast.error('请上传 .js 格式的插件')
  try {
    await uploadPlugin([file])
    toast.success('插件已上传，请点击右侧开关启用！')
  } catch (err) {
    toast.error(err.message || '上传失败')
  }
  e.target.value = ''
}

async function handlePluginFolder(e) {
  const files = Array.from(e.target.files)
  if (!files.length) return
  const hasMainJs = files.some(f => f.name === 'main.js' || f.name.endsWith('.js'))
  if (!hasMainJs) {
    toast.error('文件夹中必须包含 .js 插件主文件！')
    return
  }
  try {
    await uploadPlugin(files)
    toast.success('文件夹插件已上传，请点击右侧开关启用！')
  } catch (err) {
    toast.error(err.message || '上传失败')
  }
  e.target.value = ''
}

async function handleRefreshPlugins() {
  if (isRefreshingPlugins.value) return
  isRefreshingPlugins.value = true
  await fetchPlugins()
  isRefreshingPlugins.value = false
  toast.success('已刷新本地插件列表')
}

async function onTogglePlugin(plugin, e) {
  const isChecked = e.target.checked
  try {
    await togglePlugin(plugin.id, isChecked)
    toast.success(isChecked ? '插件已启用' : '插件已禁用')
  } catch (err) {
    e.target.checked = !isChecked
    toast.error('切换状态失败')
  }
}

// 👈 插件重命名逻辑
async function startRename(plugin) {
  editingPluginId.value = plugin.id
  editingPluginAlias.value = plugin.alias || plugin.name
  await nextTick()
  pluginEditRef.value?.focus()
  pluginEditRef.value?.select()
}

async function commitRename(plugin) {
  if (editingPluginId.value !== plugin.id) return
  editingPluginId.value = null
  const newAlias = editingPluginAlias.value.trim()
  if (newAlias !== (plugin.alias || plugin.name)) {
    try {
      await renamePlugin(plugin.id, newAlias)
      toast.success('插件备注已更新')
      await fetchPlugins() // 重新排序
    } catch (err) {
      toast.error('修改失败')
    }
  }
}

function onRenameKeydown(e, plugin) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitRename(plugin)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    editingPluginId.value = null
  }
}

async function onDeletePlugin(plugin) {
  const ok = await askConfirm({
    title: '删除插件？',
    message: `确定要永久删除「${plugin.alias || plugin.name}」吗？相关文件将被彻底移除。`,
    confirmText: '删除',
  })
  if (!ok) return
  
  try {
    await removePlugin(plugin.id)
    toast.success('插件已删除')
  } catch (err) {
    toast.error('删除失败')
  }
}

const readmeShow = ref(false)
const readmeTitle = ref('')
const readmeContent = ref('')

function openReadme(plugin) { 
  readmeTitle.value = plugin.alias || plugin.name
  readmeContent.value = plugin.readme || '# 暂无文档\n该插件未提供 README.md 文件。'
  readmeShow.value = true
}

const promptPresets = [
  { label: '简洁模式', value: '回答尽量简洁：先给结论，再补充必要细节，避免冗长铺垫。' },
  { label: '代码助手', value: '你是一名资深前端工程师。代码需可直接运行，关键逻辑加注释，并说明改动原因。' },
  { label: '翻译润色', value: '你是一名专业中英双语编辑。输出地道、准确的表达，必要时给出两种语气供选择。' },
]
const protocolOptions = [ { value: 'ollama', label: 'Ollama 原生' }, { value: 'openai', label: 'OpenAI 兼容' } ]
const themeOptions = [ { value: 'dark', label: '深色', icon: 'moon' }, { value: 'light', label: '浅色', icon: 'sun' }, { value: 'system', label: '跟随系统', icon: 'monitor' } ]

async function testConnection() {
  if (testing.value) return
  testing.value = true
  testResult.value = null
  const startTime = Date.now()
  const result = await checkStatus(currentConfig.value)
  const elapsed = Date.now() - startTime
  if (elapsed < 800) await new Promise(resolve => setTimeout(resolve, 800 - elapsed))
  testing.value = false
  if (result.ok) {
    if (result.models && result.models.length > 0) fetchedModels.value = result.models
    testResult.value = { ok: true, text: `连接成功，发现 ${result.models?.length || 0} 个模型` }
    toast.success('连接成功')
  } else {
    testResult.value = { ok: false, text: result.error?.message || '连接失败' }
    toast.error('连接失败')
  }
}

async function refreshModels() {
  if (refreshing.value) return
  refreshing.value = true
  const result = await checkStatus(currentConfig.value)
  refreshing.value = false
  if (result.ok) {
    if (result.models && result.models.length > 0) fetchedModels.value = result.models
    toast.success(`已刷新，共 ${result.models.length} 个模型`)
  } else {
    toast.error(result.error?.message || '获取模型列表失败')
  }
}

// ================= 失焦自动拉取模型 =================
// 交互约定：
// 1. API Key / 接口地址失焦时触发，两者都非空才拉取；
// 2. 防抖 350ms —— 用户在同一块区域连续跳焦点只发一次请求；
// 3. isFetching 兜底，避免用户反复切焦点造成请求堆积；
// 4. 成功后默认选中列表第一项，失败则清空模型名称并给出红色提示。
const AUTO_FETCH_DEBOUNCE = 350
const AUTO_FETCH_ERROR = '拉取失败，请检查 API Key 和接口地址是否正确'
let autoFetchTimer = null

function clearAutoFetchTimer() {
  if (autoFetchTimer) {
    clearTimeout(autoFetchTimer)
    autoFetchTimer = null
  }
}

/**
 * 前置校验：接口地址与 API Key 都非空，且当前没有正在进行的拉取。
 * 返回 true 表示可以放行。
 */
function canAutoFetch(config) {
  const baseUrl = String(config.baseUrl ?? '').trim()
  const apiKey = String(config.apiKey ?? '').trim()
  if (!baseUrl || !apiKey) return false
  if (isFetching.value) {
    toast.info('正在拉取模型列表，请稍候…')
    return false
  }
  return true
}

// 失焦入口：先做防抖，真正的校验与请求放到防抖回调里执行
function onProviderFieldBlur() {
  clearAutoFetchTimer()
  const snapshot = { ...currentConfig.value }
  if (!canAutoFetch(snapshot)) return
  autoFetchTimer = setTimeout(() => {
    autoFetchTimer = null
    autoFetchModels(snapshot)
  }, AUTO_FETCH_DEBOUNCE)
}

async function autoFetchModels(snapshot) {
  // 防抖期间配置可能又被改动，这里再校验一次
  if (!canAutoFetch(snapshot) || isFetching.value) return
  // 焦点可能已经切走/面板已关闭
  if (!props.open || activeTab.value !== 'basic') return

  isFetching.value = true
  try {
    // 约定：发起请求前先把模型名称置空，避免残留上一个服务的模型名
    currentConfig.value = { ...snapshot, model: '' }
    fetchedModels.value = []

    const result = await checkStatus({ ...snapshot, model: '' })
    if (result.ok) {
      const models = Array.isArray(result.models) ? result.models : []
      fetchedModels.value = models
      if (models.length > 0) {
        // 自动选中第一个，例如拿到 deepseek-flash / deepseek-v4-pro 就选 deepseek-flash
        currentConfig.value = { ...snapshot, model: models[0] }
        toast.success(`已刷新，共 ${models.length} 个模型`)
      } else {
        // 连接成功但没有可用模型，同样视为拉取失败
        currentConfig.value = { ...snapshot, model: '' }
        toast.error(AUTO_FETCH_ERROR)
      }
    } else {
      currentConfig.value = { ...snapshot, model: '' }
      fetchedModels.value = []
      toast.error(AUTO_FETCH_ERROR)
    }
  } catch (err) {
    // checkStatus 内部已 try/catch，这里只是兜底，保证绝不抛到渲染层
    currentConfig.value = { ...snapshot, model: '' }
    fetchedModels.value = []
    toast.error(AUTO_FETCH_ERROR)
  } finally {
    isFetching.value = false
  }
}

function applyPrompt(preset) { settings.systemPrompt = preset.value }

function onReset() {
  resetSettings()
  setTheme('dark')
  if (activeSession.value) updateSessionConfig(activeSession.value.id, null)
  testResult.value = null
  fetchedModels.value = []
  toast.success('已恢复默认设置')
}

async function onClearAll() {
  const ok = await askConfirm({ title: '清空全部对话？', message: `${chat.sessions.length} 个对话与全部消息将从本机删除，无法恢复。`, confirmText: '全部清空' })
  if (!ok) return
  clearAll()
  toast.success('已清空全部对话')
}

function onExportAll() {
  if (!chat.sessions.length) { toast.info('还没有任何对话'); return }
  exportAllSessions(chat.sessions)
  toast.success('已导出全部对话')
}

// 面板关闭/卸载时清掉待执行的防抖定时器，避免组件销毁后仍触发请求
onBeforeUnmount(clearAutoFetchTimer)
</script>

<template>
  <Transition name="panel">
    <div v-if="open" class="settings-layer" @mousedown.self="onClose">
      <section class="settings-panel" role="dialog" aria-modal="true" aria-label="设置">
        <header class="panel-head">
          <div class="head-title">
            <span class="head-icon"><AppIcon name="settings" :size="17" /></span>
            <div>
              <h2>设置</h2>
              <p>调整模型服务、插件与外观</p>
            </div>
          </div>
          <button type="button" class="dialog-close" title="关闭（Esc）" aria-label="关闭设置" @click="onClose">
            <AppIcon name="x" :size="18" />
          </button>
        </header>

        <div class="panel-tabs">
          <button :class="{ active: activeTab === 'basic' }" @click="activeTab = 'basic'">基础设置</button>
          <button :class="{ active: activeTab === 'plugins' }" @click="activeTab = 'plugins'">插件管理</button>
        </div>

        <div class="panel-body">
          <div v-show="activeTab === 'basic'" class="tab-content">
            <!-- 基础设置内容 ... 保持原样，为了节省篇幅省略中间部分 ... -->
            <section class="block">
              <div class="block-head"><h3><img :src="defaultUserAvatar" class="head-icon-img" alt="" /> 资料</h3></div>
              <div class="profile-row">
                <div class="avatar-setting">
                  <div class="avatar-preview">
                    <img v-if="userAvatar" :src="userAvatar" alt="我的头像" />
                    <img v-else :src="defaultUserAvatar" alt="默认头像" />
                  </div>
                  <div class="avatar-actions">
                    <input type="file" ref="userInput" accept="image/*" style="display: none" @change="handleFileChange($event, 'user')" />
                    <button type="button" class="btn btn-sm" @click="triggerUpload('user')">更换用户头像</button>
                    <button v-if="userAvatar" type="button" class="link-btn" @click="resetUserAvatar">恢复默认</button>
                  </div>
                </div>
                <div class="avatar-setting">
                  <!-- 直接渲染 AiAvatar（52px 档），不再套 52px 的 .avatar-preview，
                       否则两层圆角容器会互相裁切 -->
                  <AiAvatar size="settings" resettable />
                  <div class="avatar-actions">
                    <input type="file" ref="aiInput" accept="image/png, image/jpeg" style="display: none" @change="handleFileChange($event, 'ai')" />
                    <button type="button" class="btn btn-sm" @click="triggerUpload('ai')">更换 AI 头像</button>
                    <button v-if="aiAvatar" type="button" class="link-btn" @click="resetAiAvatar">恢复默认</button>
                  </div>
                </div>
              </div>
              <div class="field" style="margin-top: 8px;">
                <label class="field-label">AI 称呼</label>
                <input
                  :value="aiName"
                  class="input"
                  placeholder="例如：大肥鱼"
                  @input="e => updateName(currentProviderType, e.target.value, { deferred: true })"
                />
                <p class="hint">
                  仅影响「{{ currentProviderType === 'api' ? '云端' : '本地' }}」模式；
                  本地当前为「{{ getProfileByProvider('local').name }}」，
                  云端当前为「{{ getProfileByProvider('api').name }}」。
                </p>
              </div>
            </section>

            <section class="block">
              <div class="block-head">
                <h3><AppIcon name="plug" :size="15" /> 模型服务</h3>
                <span class="block-note" :class="{ 'is-off': chat.status === 'offline' }">
                  {{ chat.status === 'offline' ? '未连接' : chat.status === 'online' ? '已连接' : '待检测' }}
                </span>
              </div>
              <div v-if="isSessionOverride" class="info-banner">
                <AppIcon name="info" :size="14" />
                当前对话使用了独立模板，修改下方设置不会影响全局对话。
                <button type="button" class="link-btn" @click="updateSessionConfig(activeSession.id, null)">恢复跟随全局</button>
              </div>
              <div class="field">
                <label class="field-label">快捷预设</label>
                <div class="preset-row">
                  <button v-for="preset in API_PRESETS" :key="preset.label" type="button" class="chip" :title="preset.hint" :class="{ 'is-current': currentConfig.baseUrl === preset.value.baseUrl && currentConfig.model === preset.value.model }" @click="usePreset(preset)">
                    {{ preset.label }}
                  </button>
                </div>
              </div>
              <div class="segmented">
                <button v-for="option in protocolOptions" :key="option.value" type="button" :class="{ 'is-active': currentConfig.protocol === option.value }" @click="setProtocol(option.value)">{{ option.label }}</button>
              </div>
              <div class="field">
                <label class="field-label">接口地址</label>
                <input :value="currentConfig.baseUrl" @input="setBaseUrl" @blur="onProviderFieldBlur" class="input" spellcheck="false" placeholder="/api" />
                <p class="hint">实际请求：<code>{{ chatUrlPreview(currentConfig) }}</code></p>
              </div>
              <div class="field">
                <label class="field-label">API Key <span class="optional">可选</span></label>
                <input
                  ref="apiKeyRef"
                  :value="currentConfig.apiKey"
                  :class="['input', { 'is-highlighted': apiKeyHint }]"
                  @input="onApiKeyInput"
                  @blur="onProviderFieldBlur"
                  @focus="onApiKeyFocus"
                  type="password"
                  placeholder="使用云端模型需填 Key"
                />
                <p v-if="apiKeyHint" class="hint is-focus-hint">
                  <AppIcon name="sparkles" :size="12" /> 在这里填入 {{ presetDisplayName }} 的 API Key
                </p>
                <p v-else-if="isFetching" class="hint is-fetching"><AppIcon name="refresh" :size="12" class="spin" /> 正在拉取模型列表…</p>
              </div>
              <!-- 👇 新增：网络代理（全局设置，作用于后端发往模型服务的请求） -->
              <div class="field">
                <label class="field-label">网络代理 <span class="optional">全局 · 可选</span></label>
                <input v-model.trim="settings.proxyUrl" class="input" spellcheck="false" placeholder="http://127.0.0.1:10808（留空不启用）" />
                <p class="hint">访问 https 模型服务（DeepSeek / OpenAI 兼容等）时经此代理转发；本地 Ollama 与页面本身不受影响。</p>
              </div>
              <div class="field">
                <label class="field-label">模型名称</label>
                <div class="input-row">
                  <div class="input-with-dropdown">
                    <input :value="currentConfig.model" @input="e => currentConfig = { ...currentConfig, model: e.target.value }" class="input" spellcheck="false" placeholder="输入或选择模型" @focus="showModelDropdown = true" @blur="onModelInputBlur" />
                    <button type="button" class="dropdown-toggle" @mousedown.prevent="showModelDropdown = !showModelDropdown"><AppIcon name="arrowDown" :size="14" /></button>
                    <Transition name="menu">
                      <div v-if="showModelDropdown && availableModels.length" class="model-dropdown">
                        <button v-for="name in availableModels" :key="name" type="button" class="dropdown-item" @mousedown.prevent="selectModel(name)">{{ name }}</button>
                      </div>
                    </Transition>
                  </div>
                  <button type="button" class="btn btn-sm" :disabled="refreshing || isFetching" @click="refreshModels"><AppIcon name="refresh" :size="13" :class="{ 'spin': refreshing || isFetching }" /> 拉取</button>
                </div>
              </div>

              <!-- 👇 新增：高级生成参数折叠面板（模型名称下方，默认收起） -->
              <div class="adv-collapse">
                <button type="button" class="adv-toggle" :class="{ open: advancedOpen }" :aria-expanded="advancedOpen" @click="advancedOpen = !advancedOpen">
                  <AppIcon name="cpu" :size="14" />
                  高级生成参数
                  <AppIcon name="chevronDown" :size="13" class="adv-chevron" />
                </button>
                <div class="collapse-body" :class="{ open: advancedOpen }">
                  <div class="collapse-inner">
                    <div class="collapse-pad">
                      <div class="field">
                        <label class="field-label">温度 Temperature <span class="value-pill">{{ Number(settings.temperature).toFixed(1) }}</span></label>
                        <input v-model.number="settings.temperature" class="range" type="range" min="0" max="2" step="0.1" />
                      </div>
                      <div class="field">
                        <label class="field-label">最大输出 Token <span class="value-pill">{{ settings.maxTokens > 0 ? settings.maxTokens : '不限' }}</span></label>
                        <input v-model.number="settings.maxTokens" class="input" type="number" min="0" max="200000" step="128" placeholder="0 = 不限制" />
                      </div>
                      <div class="adv-row">
                        <div>
                          <p class="adv-title">流式输出 Stream</p>
                          <p class="adv-sub">开启后逐字返回；关闭则等待完整回复一次性显示</p>
                        </div>
                        <label class="toggle-switch">
                          <input type="checkbox" :checked="settings.stream !== false" @change="settings.stream = $event.target.checked" />
                          <span class="slider"></span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="test-row">
                <button type="button" class="btn btn-sm" :disabled="testing" @click="testConnection"><AppIcon name="zap" :size="13" /> {{ testing ? '检测中…' : '测试连接' }}</button>
                <span v-if="testResult" class="test-result" :class="testResult.ok ? 'ok' : 'bad'">{{ testResult.text }}</span>
              </div>
            </section>

            <section class="block">
              <div class="block-head"><h3><AppIcon name="cpu" :size="15" /> 上下文</h3></div>
              <div class="field">
                <label class="field-label">上下文轮数 <span class="value-pill">{{ settings.contextRounds }} 轮</span></label>
                <input v-model.number="settings.contextRounds" class="range" type="range" min="1" max="30" step="1" />
              </div>
            </section>

            <section class="block">
              <div class="block-head">
                <h3><AppIcon name="message" :size="15" /> 系统提示词</h3>
                <button v-if="settings.systemPrompt" type="button" class="link-btn" @click="settings.systemPrompt = ''">清空</button>
              </div>
              <textarea v-model="settings.systemPrompt" class="textarea" rows="3" placeholder="例如：你是一名严谨的技术助手，回答要先给结论。"></textarea>
              <div class="preset-row">
                <button v-for="preset in promptPresets" :key="preset.label" type="button" class="chip" :class="{ 'is-current': settings.systemPrompt === preset.value }" @click="applyPrompt(preset)">{{ preset.label }}</button>
              </div>
            </section>

            <section class="block">
              <div class="block-head"><h3><AppIcon name="sun" :size="15" /> 外观</h3></div>
              <div class="segmented">
                <button v-for="option in themeOptions" :key="option.value" type="button" :class="{ 'is-active': theme.mode === option.value }" @click="setTheme(option.value)"><AppIcon :name="option.icon" :size="14" /> {{ option.label }}</button>
              </div>
            </section>

            <section class="block">
              <div class="block-head"><h3><AppIcon name="briefcase" :size="15" /> 数据</h3></div>
              <div class="data-row">
                <button type="button" class="btn btn-sm" @click="onExportAll"><AppIcon name="download" :size="13" /> 导出全部对话</button>
                <button type="button" class="btn btn-sm btn-danger" @click="onClearAll"><AppIcon name="trash" :size="13" /> 清空全部对话</button>
              </div>
            </section>
            <p class="version">大肥鱼 · AI 对话工作台 <span>v2.0</span></p>
          </div>

          <div v-show="activeTab === 'plugins'" class="tab-content plugins-tab">
            <!-- ===== 二级 Tab：普通插件 / EXE 插件 ===== -->
            <div class="sub-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                class="sub-tab"
                :class="{ active: pluginTab === 'js' }"
                :aria-selected="pluginTab === 'js'"
                @click="pluginTab = 'js'"
              >
                <AppIcon name="braces" :size="13" />
                普通插件
                <span class="sub-tab-count">{{ jsPluginList.length }}</span>
              </button>
              <button
                type="button"
                role="tab"
                class="sub-tab"
                :class="{ active: pluginTab === 'exe' }"
                :aria-selected="pluginTab === 'exe'"
                @click="pluginTab = 'exe'"
              >
                <AppIcon name="zap" :size="13" />
                EXE 插件
                <span class="sub-tab-count">{{ exePluginList.length }}</span>
              </button>
            </div>

            <!-- ===== 普通插件 ===== -->
            <template v-if="pluginTab === 'js'">
              <div class="plugins-header">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <h3>已安装</h3>
                  <span class="plugin-count">{{ jsPluginList.length }} 个</span>
                </div>
                <div style="display: flex; gap: 6px;">
                  <input type="file" ref="pluginInput" accept=".js" style="display: none" @change="handlePluginFile" />
                  <input type="file" ref="pluginFolderInput" webkitdirectory directory multiple style="display: none" @change="handlePluginFolder" />
                  <button type="button" class="btn btn-sm" @click="triggerPluginUpload">
                    <AppIcon name="plus" :size="13" /> 单文件
                  </button>
                  <button type="button" class="btn btn-sm" @click="triggerFolderUpload">
                    <AppIcon name="folder" :size="13" /> 文件夹
                  </button>
                <button type="button" class="btn btn-sm" :disabled="isRefreshingPlugins" @click="handleRefreshPlugins">
                  <AppIcon name="refresh" :size="13" :class="{ 'spin': isRefreshingPlugins }" /> 刷新
                </button>
              </div>
            </div>

            <div class="empty-plugins" style="padding-top: 10px; margin-bottom: 10px; border-bottom: 1px dashed var(--glass-border);">
              <p style="font-size: 11px;">支持单文件或整个文件夹上传，或放入 <code>server/plugins</code> 文件夹后点击刷新。</p>
            </div>

            <div class="plugin-list" v-if="jsPluginList.length > 0">
              <div v-for="plugin in jsPluginList" :key="plugin.id" class="plugin-card">
                <div class="plugin-main">
                  <div class="plugin-icon"><AppIcon name="zap" :size="24" style="color: #4f46e5" /></div>
                  <div class="plugin-info">
                    <div class="plugin-title-row">
                      <!-- 👈 核心修改：点击名字直接重命名 -->
                      <input
                        v-if="editingPluginId === plugin.id"
                        ref="pluginEditRef"
                        v-model="editingPluginAlias"
                        class="plugin-name-input"
                        maxlength="20"
                        @blur="commitRename(plugin)"
                        @keydown="onRenameKeydown($event, plugin)"
                      />
                      <span 
                        v-else 
                        class="plugin-name" 
                        :title="(plugin.alias || plugin.name) + ' (点击修改备注)'" 
                        @click.stop="startRename(plugin)"
                      >
                        {{ plugin.alias || plugin.name }}
                      </span>
                      
                      <span class="plugin-ver">{{ plugin.version }}</span>
                      <span class="plugin-status" :class="{ 'is-off': !plugin.enabled }">
                        {{ plugin.enabled ? '已开启' : '已关闭' }}
                      </span>
                      <label class="toggle-switch">
                        <input type="checkbox" :checked="plugin.enabled" @change="onTogglePlugin(plugin, $event)" />
                        <span class="slider"></span>
                      </label>
                    </div>
                    <p class="plugin-desc">{{ plugin.desc }}</p>
                  </div>
                </div>
                <div class="plugin-footer">
                  <div class="plugin-actions">
                    <button class="act-btn" title="文档" @click.stop="openReadme(plugin)"><AppIcon name="fileText" :size="14" /></button>
                    <button class="act-btn is-danger" title="删除插件" @click.stop="onDeletePlugin(plugin)"><AppIcon name="trash" :size="14" /></button>
                  </div>
                </div>
              </div>
            </div>
            
            <div v-else class="empty-plugins">
              <AppIcon name="box" :size="32" style="opacity: 0.5; margin-bottom: 8px;" />
              <p>暂无安装的插件</p>
            </div>
            </template>

            <!-- ===== EXE 插件 ===== -->
            <template v-else>
              <div class="plugins-header">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <h3>可执行插件</h3>
                  <span class="plugin-count">{{ exePluginList.length }} 个</span>
                </div>
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="exeLoading"
                  @click="handleRefreshExePlugins"
                >
                  <AppIcon name="refresh" :size="13" :class="{ spin: exeLoading }" /> 刷新
                </button>
              </div>

              <div class="empty-plugins" style="padding-top: 10px; margin-bottom: 10px; border-bottom: 1px dashed var(--glass-border);">
                <p style="font-size: 11px;">
                  独立编译的可执行插件。把整个 exe 目录放入
                  <code>server/plugins</code> 后点击刷新。
                </p>
              </div>

              <div class="exe-list" v-if="exePluginList.length > 0">
                <ExePluginCard
                  v-for="item in exePluginList"
                  :key="item.id"
                  :plugin="item"
                  :health="exeHealth"
                  :toggling="togglingExeId === item.id"
                  @toggle="onToggleExePlugin"
                  @open="onOpenExePlugin"
                />
              </div>

              <div v-else-if="exeLoading" class="empty-plugins">
                <p>正在扫描…</p>
              </div>

              <div v-else class="empty-plugins">
                <AppIcon name="box" :size="32" style="opacity: 0.5; margin-bottom: 8px;" />
                <p>暂无 EXE 插件</p>
                <p style="font-size: 11px; margin-top: 4px;">
                  把编译好的 exe 目录放进 <code>server/plugins</code> 即可被识别
                </p>
              </div>
            </template>
          </div>
        </div>

        <footer v-if="activeTab === 'basic'" class="panel-foot">
          <button type="button" class="btn" @click="onReset"><AppIcon name="refresh" :size="14" /> 恢复默认</button>
          <button type="button" class="btn btn-primary" @click="onClose">完成</button>
        </footer>
      </section>
    </div>
  </Transition>

  <Teleport to="body">
    <Transition name="fade">
      <div v-if="readmeShow" class="readme-modal-mask" @mousedown.self="readmeShow = false">
        <div class="readme-modal">
          <header>
            <h3>{{ readmeTitle }} <span>README</span></h3>
            <button class="dialog-close" title="关闭" aria-label="关闭文档" @click="readmeShow = false">
              <AppIcon name="x" :size="18" />
            </button>
          </header>
          <div class="readme-content">
            <MarkdownBody v-if="readmeContent" :source="readmeContent" />
            <div v-else style="text-align: center; color: var(--faint); padding: 20px;">暂无文档内容</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 样式不变，新增了 .plugin-name-input 和 .plugin-name 的悬浮效果 */
.readme-modal-mask { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); display: grid; place-items: center; }
.readme-modal { width: min(600px, 90vw); max-height: 80vh; background: var(--panel-bg); border-radius: 16px; border: 1px solid var(--glass-border-strong); box-shadow: var(--shadow-2); display: flex; flex-direction: column; overflow: hidden; }
.readme-modal header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--glass-border); }
.readme-modal h3 { font-size: 15px; font-weight: 600; color: var(--text-strong); display: flex; align-items: center; gap: 8px; }
.readme-modal h3 span { font-size: 10px; background: var(--glass-hover); padding: 2px 6px; border-radius: 4px; color: var(--muted); }
.readme-content { padding: 20px; overflow-y: auto; font-size: 13px; color: var(--text); line-height: 1.6; }

.settings-layer { position: fixed; inset: 0; z-index: 80; display: flex; justify-content: flex-end; background: var(--overlay); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.settings-panel { display: flex; flex-direction: column; width: min(480px, 100%); height: 100%; background: var(--panel-bg); border-left: 1px solid var(--glass-border-strong); box-shadow: var(--shadow-2); }
.panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 18px 14px; flex: none; border-bottom: 1px solid var(--glass-border); }
.head-title { display: flex; align-items: center; gap: 11px; }
.head-icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; color: var(--accent-1); background: var(--accent-grad-soft); border: 1px solid var(--glass-border); }
.panel-head h2 { font-size: 16px; }
.panel-head p { margin-top: 1px; font-size: 11.5px; color: var(--muted); }
.panel-tabs { display: flex; gap: 20px; padding: 0 18px; border-bottom: 1px solid var(--glass-border); flex: none; }
.panel-tabs button { position: relative; padding: 12px 0; font-size: 14px; font-weight: 600; color: var(--muted); transition: color 0.2s; }
.panel-tabs button:hover { color: var(--text); }
.panel-tabs button.active { color: var(--text-strong); }
.panel-tabs button.active::after { content: ''; position: absolute; bottom: -1px; left: 0; width: 100%; height: 2px; background: var(--text-strong); border-radius: 2px 2px 0 0; }
.panel-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 18px 8px; display: flex; flex-direction: column; }
.tab-content { display: flex; flex-direction: column; gap: 14px; }
.block { display: flex; flex-direction: column; gap: 11px; padding: 14px; border-radius: 16px; background: var(--glass); border: 1px solid var(--glass-border); }
.block-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.block-head h3 { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 620; color: var(--text-strong); }
.block-head h3 :deep(svg) { color: var(--accent-1); }
.block-note { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; color: #34d399; background: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.24); }
.block-note.is-off { color: #fb7185; background: rgba(251, 113, 133, 0.12); border-color: rgba(251, 113, 133, 0.24); }
.profile-row { display: flex; gap: 20px; flex-wrap: wrap; }
.avatar-setting { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 150px; }
.avatar-preview { width: 52px; height: 52px; border-radius: 16px; background: #ffffff; color: #fff; display: grid; place-items: center; font-size: 20px; font-weight: 700; overflow: hidden; border: 1px solid var(--glass-border); box-shadow: var(--shadow-1); flex: none; }
.avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
.avatar-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.head-icon-img { width: 18px; height: 18px; object-fit: contain; border-radius: 4px; margin-right: 4px; }
.ai-avatar { background: var(--accent-grad); }
.link-btn { font-size: 11.5px; color: var(--muted); padding: 2px 6px; border-radius: 6px; }
.link-btn:hover { color: var(--text); background: var(--glass-hover); }
.preset-row { display: flex; flex-wrap: wrap; gap: 6px; }
.preset-row .chip { height: 26px; font-size: 11px; cursor: pointer; }
.preset-row .chip.is-current { color: var(--text-strong); border-color: rgba(139, 92, 246, 0.5); background: var(--accent-grad-soft); }
.input-row { display: flex; gap: 7px; }
.input-row .btn { flex: none; }
.input-with-dropdown { position: relative; flex: 1; min-width: 0; }
.input-with-dropdown .input { width: 100%; padding-right: 32px; }
.dropdown-toggle { position: absolute; right: 1px; top: 1px; bottom: 1px; width: 32px; display: grid; place-items: center; color: var(--faint); border-radius: 0 12px 12px 0; transition: color 0.2s, background 0.2s; }
.dropdown-toggle:hover { color: var(--text); background: var(--glass-hover); }
.model-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 50; max-height: 200px; overflow-y: auto; padding: 6px; border-radius: 12px; background: var(--glass-strong); border: 1px solid var(--glass-border-strong); box-shadow: var(--shadow-2); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
.dropdown-item { width: 100%; display: block; padding: 8px 10px; font-size: 12.5px; color: var(--text); text-align: left; border-radius: 6px; font-family: var(--font-mono); transition: background 0.15s; }
.dropdown-item:hover { background: var(--glass-hover); }
.hint { font-size: 11px; color: var(--faint); line-height: 1.45; }
.hint.is-fetching { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); }

/* ── 「聚焦 API Key」高亮提示 ──
 * 用动画而不是静态边框：脉冲 3 次后停住，等定时器把 class 摘掉。
 * box-shadow 不占布局，不会让下方元素跳动。
 */
.hint.is-focus-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--accent-2);
  font-weight: 500;
}
.input.is-highlighted {
  border-color: var(--accent-1);
  animation: api-key-pulse 0.9s var(--ease) 3;
}
@keyframes api-key-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(139, 92, 246, 0);
    border-color: var(--glass-border-strong);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.22);
    border-color: var(--accent-1);
  }
}
/* 尊重系统的「减少动态效果」偏好 */
@media (prefers-reduced-motion: reduce) {
  .input.is-highlighted {
    animation: none;
    border-color: var(--accent-1);
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.22);
  }
}
.optional { font-size: 10px; color: var(--faint); font-weight: 400; }
.value-pill { font-family: var(--font-mono); font-size: 10.5px; padding: 1px 7px; border-radius: 999px; color: var(--text); background: var(--glass-hover); border: 1px solid var(--glass-border); }
.test-row { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.test-result { font-size: 11px; line-height: 1.4; color: var(--muted); flex: 1; min-width: 0; }
.test-result.ok { color: #34d399; }
.test-result.bad { color: #fb7185; }

/* ===== 高级生成参数折叠面板 ===== */
.adv-collapse { border: 1px dashed var(--glass-border); border-radius: 12px; overflow: hidden; }
.adv-toggle { width: 100%; display: flex; align-items: center; gap: 7px; padding: 9px 11px; font-size: 12px; font-weight: 620; color: var(--muted); transition: color 0.15s, background 0.15s; }
.adv-toggle:hover { color: var(--text); background: var(--glass-hover); }
.adv-toggle.open { color: var(--text-strong); border-bottom: 1px solid var(--glass-border); }
.adv-chevron { margin-left: auto; transition: transform 0.22s var(--ease); }
.adv-toggle.open .adv-chevron { transform: rotate(180deg); }
/* grid-template-rows 0fr→1fr 技巧：内层 overflow:hidden + min-height:0 实现平滑展开 */
.collapse-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.28s var(--ease); }
.collapse-body.open { grid-template-rows: 1fr; }
.collapse-inner { overflow: hidden; min-height: 0; }
.collapse-pad { display: flex; flex-direction: column; gap: 11px; padding: 11px 11px 12px; }
.adv-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.adv-title { font-size: 12.5px; font-weight: 620; color: var(--text); }
.adv-sub { font-size: 11px; color: var(--faint); margin-top: 2px; line-height: 1.45; }
.data-row { display: flex; gap: 8px; flex-wrap: wrap; }
.version { text-align: center; font-size: 10.5px; color: var(--faint); padding: 4px 0 10px; }
.panel-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 18px calc(14px + env(safe-area-inset-bottom)); flex: none; border-top: 1px solid var(--glass-border); }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.plugins-tab { padding-top: 4px; }

/* ===== 二级 Tab（普通插件 / EXE 插件）===== */
.sub-tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 11px;
  background: var(--glass);
  border: 1px solid var(--glass-border);
  margin-bottom: 4px;
}
.sub-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--muted);
  transition: color 0.18s var(--ease), background 0.18s var(--ease),
    box-shadow 0.18s var(--ease);
}
.sub-tab:hover { color: var(--text); }
.sub-tab.active {
  color: var(--text-strong);
  background: var(--accent-grad-soft);
  box-shadow: inset 0 0 0 1px rgba(139, 92, 246, 0.34);
}
.sub-tab.active :deep(svg) { color: var(--accent-1); }
.sub-tab-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  color: var(--faint);
  background: var(--glass-hover);
  border: 1px solid var(--glass-border);
}
.sub-tab.active .sub-tab-count {
  color: var(--accent-1);
  background: rgba(139, 92, 246, 0.14);
  border-color: rgba(139, 92, 246, 0.3);
}

.exe-list { display: flex; flex-direction: column; gap: 12px; }
.plugins-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.plugins-header h3 { font-size: 14px; font-weight: 600; color: var(--text-strong); }
.plugin-count { font-size: 12px; color: var(--muted); }
.plugin-list { display: flex; flex-direction: column; gap: 12px; }
.plugin-card { padding: 16px; border-radius: 16px; background: var(--panel-bg); border: 1px solid var(--glass-border); box-shadow: var(--shadow-1); }
.plugin-main { display: flex; gap: 12px; }
.plugin-icon { width: 42px; height: 42px; flex: none; border-radius: 12px; background: rgba(79, 70, 229, 0.1); display: grid; place-items: center; }
.plugin-info { flex: 1; min-width: 0; }
.plugin-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* 👈 新增：插件名称悬浮与输入框 */
.plugin-name { font-size: 14px; font-weight: 600; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; cursor: pointer; transition: color 0.2s; }
.plugin-name:hover { color: var(--accent-1); text-decoration: underline; }
.plugin-name-input { font-size: 14px; font-weight: 600; color: var(--text-strong); background: var(--glass); border: 1px solid rgba(139, 92, 246, 0.5); border-radius: 4px; padding: 0 6px; outline: none; width: 120px; box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.15); }

.plugin-ver { font-size: 11px; color: var(--faint); font-family: var(--font-mono); }
.plugin-status { font-size: 10px; color: #34d399; background: rgba(52, 211, 153, 0.1); padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px; }
.plugin-status.is-off { color: #fb7185; background: rgba(251, 113, 133, 0.1); }
.plugin-desc { font-size: 12px; color: var(--muted); line-height: 1.5; margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.toggle-switch { position: relative; display: inline-block; width: 36px; height: 20px; margin-left: auto; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; inset: 0; background-color: var(--glass-hover); transition: .3s; border-radius: 20px; }
.slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 2px; bottom: 2px; background-color: white; transition: .3s; border-radius: 50%; }
input:checked + .slider { background-color: #34d399; }
input:checked + .slider:before { transform: translateX(16px); }
.plugin-footer { display: flex; justify-content: flex-end; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--glass-border); }
.plugin-actions { display: flex; gap: 6px; }
.act-btn { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: var(--muted); transition: all 0.15s; }
.act-btn:hover, .act-btn.active { color: var(--text-strong); background: var(--glass-hover); }
.act-btn.is-danger:hover { color: #f87171; background: rgba(248, 113, 113, 0.1); }
.info-banner { display: flex; align-items: center; gap: 8px; padding: 10px; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 10px; font-size: 11.5px; color: var(--text); margin-bottom: 4px; }
.info-banner .link-btn { color: var(--accent-1); text-decoration: underline; margin-left: auto; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.panel-enter-active, .panel-leave-active { transition: opacity 0.22s var(--ease); }
.panel-enter-from, .panel-leave-to { opacity: 0; }
.panel-enter-active .settings-panel, .panel-leave-active .settings-panel { transition: transform 0.28s var(--ease); }
.panel-enter-from .settings-panel, .panel-leave-to .settings-panel { transform: translateX(100%); }
@media (max-width: 560px) { .settings-panel { width: 100%; border-left: none; } }
</style>