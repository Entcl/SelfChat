<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import MarkdownBody from './MarkdownBody.vue' // 👈 引入 Markdown 渲染组件
import { chat, checkStatus, clearAll, activeSession, updateSessionConfig } from '../store/chat'
import { askConfirm } from '../store/confirm'
import { chatUrlPreview, resetSettings, settings, API_PRESETS } from '../store/settings'
import { resolvedTheme, setTheme, theme } from '../store/theme'
import { closeSettings } from '../store/ui'
import { toast } from '../store/toast'
import { userAvatar, aiAvatar, aiName, setUserAvatar, setAiAvatar, setAiName } from '../store/user'
import { exportAllSessions } from '../utils/export'
import defaultUserAvatar from '../assets/batman.svg'
import { plugins, fetchPlugins, uploadPlugin, togglePlugin } from '../store/plugins'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const activeTab = ref('basic')
const testing = ref(false)
const testResult = ref(null)
const refreshing = ref(false)
const showModelDropdown = ref(false)
const isRefreshingPlugins = ref(false)

const fetchedModels = ref([])
const isSessionOverride = computed(() => !!activeSession.value?.config)

const currentConfig = computed({
  get: () => {
    return activeSession.value?.config || {
      protocol: settings.protocol,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
    }
  },
  set: (val) => {
    if (activeSession.value) {
      updateSessionConfig(activeSession.value.id, val)
      testResult.value = null
    }
  }
})

function onClose() {
  if (activeSession.value) {
    updateSessionConfig(activeSession.value.id, { ...currentConfig.value })
  }
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
  if (fetchedModels.value.length > 0) {
    return fetchedModels.value 
  }
  const isCloud = currentConfig.value.protocol === 'openai'
  const currentUrl = currentConfig.value.baseUrl

  if (!isCloud) {
    const localPreset = API_PRESETS.find(p => p.label === '本地 Ollama')?.models || []
    return Array.from(new Set([...(settings.models || []), ...localPreset])).filter(Boolean)
  }

  const matchedPreset = API_PRESETS.find(p => p.value.baseUrl === currentUrl)
  return matchedPreset?.models || ['deepseek-flash', 'deepseek-v4-pro']
})

function usePreset(preset) {
  if (!preset.value) return
  fetchedModels.value = []
  
  let newKey = currentConfig.value.apiKey
  if (preset.value.protocol === 'ollama') {
    newKey = ''
  } else if (currentConfig.value.baseUrl !== preset.value.baseUrl) {
    newKey = ''
  }

  currentConfig.value = {
    ...currentConfig.value,
    protocol: preset.value.protocol,
    baseUrl: preset.value.baseUrl,
    model: preset.value.model,
    apiKey: newKey
  }
  toast.success(`已切换至: ${preset.label}`)

  if (preset.value.protocol === 'openai' && !newKey) {
    setTimeout(() => {
      toast.info('请在下方 API Key 输入框中填入你的密钥')
    }, 300)
  }
}

function selectModel(name) {
  currentConfig.value = { ...currentConfig.value, model: name }
  showModelDropdown.value = false
}

function onModelInputBlur() {
  setTimeout(() => {
    showModelDropdown.value = false
  }, 150)
}

watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    fetchedModels.value = [] 
    await silentFetchModels()
    
    if (!testing.value) {
      checkStatus().then(res => {
        if (res.ok && !chat.streaming) chat.status = 'online'
      })
    }
    fetchPlugins() 
  }
})

// 头像上传
const userInput = ref(null)
const aiInput = ref(null)

function triggerUpload(type) {
  if (type === 'user') userInput.value?.click()
  else aiInput.value?.click()
}

function handleFileChange(e, type) {
  const file = e.target.files[0]
  if (!file) return
  if (file.size > 10 * 1024 * 1024) {
    toast.error('图片太大，请上传 10MB 以内的图片')
    return
  }
  const reader = new FileReader()
  reader.onload = (event) => {
    if (type === 'user') setUserAvatar(event.target.result)
    else setAiAvatar(event.target.result)
    toast.success('头像已更新')
  }
  reader.readAsDataURL(file)
  e.target.value = ''
}

function resetUserAvatar() { setUserAvatar(''); toast.success('已恢复默认用户头像') }
function resetAiAvatar() { setAiAvatar(''); toast.success('已恢复默认 AI 头像') }

// ================= 插件相关 =================
const pluginInput = ref(null)
const openMenuId = ref(null)

function toggleMenu(id) { openMenuId.value = openMenuId.value === id ? null : id }
function onDocPointerDown(e) { if (openMenuId.value && !e.target.closest('.plugin-more-wrap')) openMenuId.value = null }
onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown))

function triggerPluginUpload() { pluginInput.value?.click() }

async function handlePluginFile(e) {
  const file = e.target.files[0]
  if (!file) return
  if (!file.name.endsWith('.js')) {
    toast.error('请上传 .js 格式的插件')
    return
  }
  try {
    await uploadPlugin(file)
    toast.success('插件已上传，请点击右侧开关启用！')
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

const readmeModal = ref({ show: false, title: '', content: '' })
function openReadme(plugin) { 
  readmeModal.value = { show: true, title: plugin.name, content: plugin.readme || '暂无文档' } 
}

// 基础设置逻辑
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
    if (result.models && result.models.length > 0) {
      fetchedModels.value = result.models
    }
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
    if (result.models && result.models.length > 0) {
      fetchedModels.value = result.models
    }
    toast.success(`已刷新，共 ${result.models.length} 个模型`)
  } else {
    toast.error(result.error?.message || '获取模型列表失败')
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
          <button type="button" class="icon-btn" title="关闭（Esc）" @click="onClose">
            <AppIcon name="x" :size="18" />
          </button>
        </header>

        <div class="panel-tabs">
          <button :class="{ active: activeTab === 'basic' }" @click="activeTab = 'basic'">基础设置</button>
          <button :class="{ active: activeTab === 'plugins' }" @click="activeTab = 'plugins'">插件管理</button>
        </div>

        <div class="panel-body">
          <div v-show="activeTab === 'basic'" class="tab-content">
            <!-- 资料 -->
            <section class="block">
              <div class="block-head">
                <h3><img :src="defaultUserAvatar" class="head-icon-img" alt="" /> 资料</h3>
              </div>
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
                  <div class="avatar-preview ai-avatar">
                    <img v-if="aiAvatar" :src="aiAvatar" alt="AI 头像" />
                    <span v-else>鱼</span>
                  </div>
                  <div class="avatar-actions">
                    <input type="file" ref="aiInput" accept="image/*" style="display: none" @change="handleFileChange($event, 'ai')" />
                    <button type="button" class="btn btn-sm" @click="triggerUpload('ai')">更换 AI 头像</button>
                    <button v-if="aiAvatar" type="button" class="link-btn" @click="resetAiAvatar">恢复默认</button>
                  </div>
                </div>
              </div>
              <div class="field" style="margin-top: 8px;">
                <label class="field-label">AI 称呼</label>
                <input :value="aiName" class="input" placeholder="例如：大肥鱼" @input="e => setAiName(e.target.value)" />
              </div>
            </section>

            <!-- 模型服务 -->
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
                  <button 
                    v-for="preset in API_PRESETS" 
                    :key="preset.label" 
                    type="button" 
                    class="chip" 
                    :title="preset.hint" 
                    :class="{ 'is-current': currentConfig.baseUrl === preset.value.baseUrl && currentConfig.model === preset.value.model }" 
                    @click="usePreset(preset)"
                  >
                    {{ preset.label }}
                  </button>
                </div>
              </div>

              <div class="segmented">
                <button 
                  v-for="option in protocolOptions" 
                  :key="option.value" 
                  type="button" 
                  :class="{ 'is-active': currentConfig.protocol === option.value }" 
                  @click="setProtocol(option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
              <div class="field">
                <label class="field-label">接口地址</label>
                <input 
                  :value="currentConfig.baseUrl" 
                  @input="setBaseUrl" 
                  class="input" 
                  spellcheck="false" 
                  placeholder="/api" 
                />
                <p class="hint">实际请求：<code>{{ chatUrlPreview(currentConfig) }}</code></p>
              </div>
              <div class="field">
                <label class="field-label">API Key <span class="optional">可选</span></label>
                <input :value="currentConfig.apiKey" @input="e => currentConfig = { ...currentConfig, apiKey: e.target.value }" class="input" type="password" placeholder="使用云端模型需填 Key" />
              </div>
              
              <div class="field">
                <label class="field-label">模型名称</label>
                <div class="input-row">
                  <div class="input-with-dropdown">
                    <input 
                      :value="currentConfig.model" 
                      @input="e => currentConfig = { ...currentConfig, model: e.target.value }"
                      class="input" 
                      spellcheck="false" 
                      placeholder="输入或选择模型" 
                      @focus="showModelDropdown = true"
                      @blur="onModelInputBlur"
                    />
                    <button 
                      type="button" 
                      class="dropdown-toggle" 
                      @mousedown.prevent="showModelDropdown = !showModelDropdown"
                    >
                      <AppIcon name="arrowDown" :size="14" />
                    </button>
                    
                    <Transition name="menu">
                      <div v-if="showModelDropdown && availableModels.length" class="model-dropdown">
                        <button
                          v-for="name in availableModels"
                          :key="name"
                          type="button"
                          class="dropdown-item"
                          @mousedown.prevent="selectModel(name)"
                        >
                          {{ name }}
                        </button>
                      </div>
                    </Transition>
                  </div>
                  <button type="button" class="btn btn-sm" :disabled="refreshing" @click="refreshModels">
                    <AppIcon name="refresh" :size="13" :class="{ 'spin': refreshing }" /> 拉取
                  </button>
                </div>
              </div>

              <div class="test-row">
                <button type="button" class="btn btn-sm" :disabled="testing" @click="testConnection"><AppIcon name="zap" :size="13" /> {{ testing ? '检测中…' : '测试连接' }}</button>
                <span v-if="testResult" class="test-result" :class="testResult.ok ? 'ok' : 'bad'">{{ testResult.text }}</span>
              </div>
            </section>

            <!-- 生成参数 -->
            <section class="block">
              <div class="block-head"><h3><AppIcon name="cpu" :size="15" /> 生成参数</h3></div>
              <div class="field">
                <label class="field-label">温度 <span class="value-pill">{{ Number(settings.temperature).toFixed(1) }}</span></label>
                <input v-model.number="settings.temperature" class="range" type="range" min="0" max="2" step="0.1" />
              </div>
              <div class="field">
                <label class="field-label">上下文轮数 <span class="value-pill">{{ settings.contextRounds }} 轮</span></label>
                <input v-model.number="settings.contextRounds" class="range" type="range" min="1" max="30" step="1" />
              </div>
            </section>

            <!-- 系统提示词 -->
            <section class="block">
              <div class="block-head">
                <h3><AppIcon name="message" :size="15" /> 系统提示词</h3>
                <button v-if="settings.systemPrompt" type="button" class="link-btn" @click="settings.systemPrompt = ''">清空</button>
              </div>
              <textarea
                v-model="settings.systemPrompt"
                class="textarea"
                rows="3"
                placeholder="例如：你是一名严谨的技术助手，回答要先给结论。"
              ></textarea>
              <div class="preset-row">
                <button
                  v-for="preset in promptPresets"
                  :key="preset.label"
                  type="button"
                  class="chip"
                  :class="{ 'is-current': settings.systemPrompt === preset.value }"
                  @click="applyPrompt(preset)"
                >
                  {{ preset.label }}
                </button>
              </div>
            </section>

            <!-- 外观 -->
            <section class="block">
              <div class="block-head"><h3><AppIcon name="sun" :size="15" /> 外观</h3></div>
              <div class="segmented">
                <button v-for="option in themeOptions" :key="option.value" type="button" :class="{ 'is-active': theme.mode === option.value }" @click="setTheme(option.value)"><AppIcon :name="option.icon" :size="14" /> {{ option.label }}</button>
              </div>
            </section>

            <!-- 数据 -->
            <section class="block">
              <div class="block-head"><h3><AppIcon name="briefcase" :size="15" /> 数据</h3></div>
              <div class="data-row">
                <button type="button" class="btn btn-sm" @click="onExportAll"><AppIcon name="download" :size="13" /> 导出全部对话</button>
                <button type="button" class="btn btn-sm btn-danger" @click="onClearAll"><AppIcon name="trash" :size="13" /> 清空全部对话</button>
              </div>
            </section>
            <p class="version">大肥鱼 · AI 对话工作台 <span>v2.0</span></p>
          </div>

          <!-- 插件管理 -->
          <div v-show="activeTab === 'plugins'" class="tab-content plugins-tab">
            <div class="plugins-header">
              <div style="display: flex; align-items: center; gap: 10px;">
                <h3>已安装</h3>
                <span class="plugin-count">{{ plugins.length }} 个</span>
              </div>
              <div style="display: flex; gap: 6px;">
                <input type="file" ref="pluginInput" accept=".js" style="display: none" @change="handlePluginFile" />
                <button type="button" class="btn btn-sm" @click="triggerPluginUpload">
                  <AppIcon name="plus" :size="13" /> 上传
                </button>
                <button type="button" class="btn btn-sm" :disabled="isRefreshingPlugins" @click="handleRefreshPlugins">
                  <AppIcon name="refresh" :size="13" :class="{ 'spin': isRefreshingPlugins }" /> 刷新
                </button>
              </div>
            </div>

            <div class="empty-plugins" style="padding-top: 10px; margin-bottom: 10px; border-bottom: 1px dashed var(--glass-border);">
              <p style="font-size: 11px;">支持单文件上传，或放入 <code>server/plugins</code> 文件夹（支持子文件夹）后点击刷新。</p>
            </div>

            <div class="plugin-list" v-if="plugins.length > 0">
              <div v-for="plugin in plugins" :key="plugin.id" class="plugin-card">
                <div class="plugin-main">
                  <div class="plugin-icon"><AppIcon name="zap" :size="24" style="color: #4f46e5" /></div>
                  <div class="plugin-info">
                    <div class="plugin-title-row">
                      <span class="plugin-name" :title="plugin.name">{{ plugin.name }}</span>
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
                    <button class="act-btn" title="文档" @click="openReadme(plugin)"><AppIcon name="fileText" :size="14" /></button>
                  </div>
                </div>
              </div>
            </div>
            
            <div v-else class="empty-plugins">
              <AppIcon name="box" :size="32" style="opacity: 0.5; margin-bottom: 8px;" />
              <p>暂无安装的插件</p>
            </div>
          </div>
        </div>

        <footer v-if="activeTab === 'basic'" class="panel-foot">
          <button type="button" class="btn" @click="onReset"><AppIcon name="refresh" :size="14" /> 恢复默认</button>
          <button type="button" class="btn btn-primary" @click="onClose">完成</button>
        </footer>
      </section>
    </div>
  </Transition>

  <Transition name="fade">
    <div v-if="readmeModal.show" class="readme-modal-mask" @mousedown.self="readmeModal.show = false">
      <div class="readme-modal">
        <header>
          <h3>{{ readmeModal.title }} <span>README</span></h3>
          <button class="icon-btn" @click="readmeModal.show = false"><AppIcon name="x" :size="18" /></button>
        </header>
        <!-- 👈 核心修改：使用 MarkdownBody 渲染 -->
        <div class="readme-content">
          <MarkdownBody :source="readmeModal.content" />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
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
.optional { font-size: 10px; color: var(--faint); font-weight: 400; }
.value-pill { font-family: var(--font-mono); font-size: 10.5px; padding: 1px 7px; border-radius: 999px; color: var(--text); background: var(--glass-hover); border: 1px solid var(--glass-border); }
.test-row { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.test-result { font-size: 11px; line-height: 1.4; color: var(--muted); flex: 1; min-width: 0; }
.test-result.ok { color: #34d399; }
.test-result.bad { color: #fb7185; }
.data-row { display: flex; gap: 8px; flex-wrap: wrap; }
.version { text-align: center; font-size: 10.5px; color: var(--faint); padding: 4px 0 10px; }
.panel-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 18px calc(14px + env(safe-area-inset-bottom)); flex: none; border-top: 1px solid var(--glass-border); }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.plugins-tab { padding-top: 4px; }
.plugins-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.plugins-header h3 { font-size: 14px; font-weight: 600; color: var(--text-strong); }
.plugin-count { font-size: 12px; color: var(--muted); }
.plugin-list { display: flex; flex-direction: column; gap: 12px; }
.plugin-card { padding: 16px; border-radius: 16px; background: var(--panel-bg); border: 1px solid var(--glass-border); box-shadow: var(--shadow-1); }
.plugin-main { display: flex; gap: 12px; }
.plugin-icon { width: 42px; height: 42px; flex: none; border-radius: 12px; background: rgba(79, 70, 229, 0.1); display: grid; place-items: center; }
.plugin-info { flex: 1; min-width: 0; }
.plugin-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.plugin-name { font-size: 14px; font-weight: 600; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
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
.plugin-more-wrap { position: relative; }
.dropdown-menu { position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 50; width: 140px; padding: 6px; border-radius: 12px; background: var(--glass-strong); border: 1px solid var(--glass-border-strong); box-shadow: var(--shadow-2); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
.menu-item { width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: 12px; color: var(--text); border-radius: 6px; text-align: left; }
.menu-item:hover { background: var(--glass-hover); }
.menu-item.is-danger { color: #f87171; }
.menu-item.is-danger:hover { background: rgba(248, 113, 113, 0.1); }
.menu-divider { height: 1px; background: var(--glass-border); margin: 4px 0; }
.menu-enter-active, .menu-leave-active { transition: opacity 0.15s, transform 0.15s; }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(4px); }
.readme-modal-mask { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); display: grid; place-items: center; }
.readme-modal { width: min(600px, 90vw); max-height: 80vh; background: var(--panel-bg); border-radius: 16px; border: 1px solid var(--glass-border-strong); box-shadow: var(--shadow-2); display: flex; flex-direction: column; overflow: hidden; }
.readme-modal header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--glass-border); }
.readme-modal h3 { font-size: 15px; font-weight: 600; color: var(--text-strong); display: flex; align-items: center; gap: 8px; }
.readme-modal h3 span { font-size: 10px; background: var(--glass-hover); padding: 2px 6px; border-radius: 4px; color: var(--muted); }
.readme-content { padding: 20px; overflow-y: auto; font-size: 13px; color: var(--text); line-height: 1.6; }
/* 移除原有的 pre 标签样式，因为现在由 MarkdownBody 接管 */
.readme-content pre { white-space: pre-wrap; font-family: var(--font-mono); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.empty-plugins { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px 0; color: var(--faint); font-size: 13px; }
.info-banner { display: flex; align-items: center; gap: 8px; padding: 10px; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 10px; font-size: 11.5px; color: var(--text); margin-bottom: 4px; }
.info-banner .link-btn { color: var(--accent-1); text-decoration: underline; margin-left: auto; }
@media (max-width: 560px) { .settings-panel { width: 100%; border-left: none; } }
</style>