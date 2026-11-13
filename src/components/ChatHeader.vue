<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import WindowControls from './WindowControls.vue'
import { activeSession, chat, createSession, renameSession, updateSessionConfig } from '../store/chat'
import { settings, API_PRESETS } from '../store/settings'
import { cycleTheme, resolvedTheme, theme } from '../store/theme'
import { focusApiKey, openDrawer, openSettings, toggleExportMenu, ui } from '../store/ui'
import { toast } from '../store/toast'
import { exportAllSessions, exportSession } from '../utils/export'
import { aiName } from '../store/user'
import AiAvatar from './AiAvatar.vue'

const session = activeSession
const menuRef = ref(null)
const renaming = ref(false)
const draft = ref('')
const titleRef = ref(null)

const apiMenuOpen = ref(false)
/** 联动聚焦的延迟定时器（组件卸载/重复点击时清理） */
let focusTimer = null
const apiMenuRef = ref(null)

const currentApiLabel = computed(() => {
  if (!session.value?.config) return '跟随全局'
  const conf = session.value.config
  // 同一个预设可能以两种 baseUrl 形式落地（value / headerValue），都要能匹配上标签
  const match = API_PRESETS.find((p) =>
    [p.value, p.headerValue].filter(Boolean).some(
      (v) => v?.model === conf?.model && v?.baseUrl === conf?.baseUrl,
    ),
  )
  return match ? match.label : '自定义'
})

function changeApiPreset(preset) {
  // 立即关闭菜单，防止卡死或视觉残留
  apiMenuOpen.value = false

  if (!session.value) return

  try {
    if (!preset.value) {
      updateSessionConfig(session.value.id, null)
      toast.success('已恢复跟随全局设置')
      return
    }

    // 头部下拉使用 headerValue（如 DeepSeek 填 https://api.deepseek.com），
    // 未定义 headerValue 的预设回退到 value
    const target = preset.headerValue || preset.value

    let newKey = session.value.config?.apiKey || ''
    if (target.protocol === 'ollama') {
      newKey = ''
    } else if (session.value.config?.baseUrl !== target.baseUrl) {
      newKey = ''
    }

    updateSessionConfig(session.value.id, {
      ...target,
      apiKey: newKey,
    })

    // ── 云端服务联动 ──────────────────────────────────────────
    // 选中 DeepSeek / OpenAI 兼容这类需要 Key 的服务时，
    // 直接把用户送到「基础设置 → 模型服务」并聚焦 API Key 输入框，
    // 省掉「看到 toast → 自己找设置 → 找 Tab → 找输入框」的四步。
    const needsKey = target.protocol === 'openai' && !newKey
    if (needsKey) {
      toast.success(`已应用模板: ${preset.label}`)
      // 让 toast 先渲染一帧再开面板，避免两个动效打架。
      // 连点多次时先清掉上一个定时器，保证只开一次。
      if (focusTimer) clearTimeout(focusTimer)
      focusTimer = setTimeout(() => {
        focusTimer = null
        focusApiKey()
      }, 120)
      return
    }

    if (preset.custom) {
      toast.success('已切换至: OpenAI 兼容')
    } else {
      toast.success(`已应用模板: ${preset.label}`)
    }
  } catch (err) {
    console.error('切换预设出错:', err)
    toast.error('切换失败，请查看控制台')
  }
}

function onDocPointerDown(event) {
  if (!ui.exportOpen && !apiMenuOpen.value) return
  if (menuRef.value && !menuRef.value.contains(event.target)) toggleExportMenu(false)
  // 👈 核心修复 2：严格判断是否在菜单内部点击
  if (apiMenuRef.value && !apiMenuRef.value.contains(event.target)) {
    apiMenuOpen.value = false
  }
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  if (focusTimer) {
    clearTimeout(focusTimer)
    focusTimer = null
  }
})

const messageCount = computed(() => session.value?.messages.length ?? 0)

const statusText = computed(() => {
  if (chat.streaming) return '正在生成'
  if (chat.status === 'online') return '已连接'
  if (chat.status === 'offline') return '未连接'
  return '检测中'
})

const statusClass = computed(() => `is-${chat.streaming ? 'streaming' : chat.status}`)

const themeIcon = computed(() => {
  if (theme.mode === 'system') return 'monitor'
  return resolvedTheme.value === 'dark' ? 'moon' : 'sun'
})

const themeTitle = computed(
  () => ({ dark: '深色模式 · 点击切换', light: '浅色模式 · 点击切换', system: '跟随系统 · 点击切换' })[theme.mode],
)

function doExport(format) {
  toggleExportMenu(false)
  if (!session.value || !session.value.messages.length) {
    toast.info('当前对话还没有内容可以导出')
    return
  }
  exportSession(session.value, format)
  toast.success(format === 'json' ? '已导出 JSON 文件' : '已导出 Markdown 文件')
}

function doExportAll() {
  toggleExportMenu(false)
  if (!chat.sessions.length) {
    toast.info('还没有任何对话')
    return
  }
  exportAllSessions(chat.sessions)
  toast.success('已导出全部对话')
}

async function startRename() {
  if (!session.value) return
  draft.value = session.value.title
  renaming.value = true
  await nextTick()
  titleRef.value?.focus()
  titleRef.value?.select()
}

/**
 * 双击标题文字进入重命名。
 *
 * 为什么要处理「双击拖拽冲突」：
 * Electron 下 .chat-header 整条是 -webkit-app-region: drag，
 * 双击会被系统当成「最大化/还原」的手势，浏览器层的 dblclick 可能根本不触发。
 * 所以标题元素本身标了 -webkit-app-region: no-drag（见样式），
 * 保证双击事件先到 Vue 手里，同时拖拽其它空白区域仍然正常。
 */
function onTitleDblClick() {
  if (renaming.value) return
  startRename()
}

function commitRename() {
  if (!renaming.value) return
  renaming.value = false
  if (session.value) renameSession(session.value.id, draft.value)
}

function cancelRename() {
  renaming.value = false
}

function onTitleKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    commitRename()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}
</script>

<template>
  <header class="chat-header">
    <div class="header-left">
      <button type="button" class="icon-btn only-mobile" title="打开会话列表" @click="openDrawer">
        <AppIcon name="menu" :size="19" />
      </button>

      <AiAvatar size="header" editable />

      <div class="header-titles">
        <div class="title-row">
          <input
            v-if="renaming"
            ref="titleRef"
            v-model="draft"
            class="title-input"
            maxlength="48"
            @blur="commitRename"
            @keydown="onTitleKeydown"
          />
          <h2
            v-else
            class="title"
            :title="`${session?.title || '新对话'}（双击重命名）`"
            @dblclick="onTitleDblClick"
          >{{ session?.title || '新对话' }}</h2>
          <!-- 角色名改成独立小标签，不再和会话标题拼成一个字符串。
               用户手动改过名字（如「本地大肥鱼」）时，这里显示的就是他改的那个名字，
               前面不会再有硬拼的 DeepSeek / 本地 前缀。
               放在 v-if/v-else 之外，重命名过程中标签不会闪没。 -->
          <span v-if="aiName" class="role-badge" :title="`当前角色：${aiName}`">{{ aiName }}</span>
          <button
            v-if="!renaming"
            type="button"
            class="title-edit"
            title="重命名对话"
            @click="startRename"
          >
            <AppIcon name="edit" :size="12" />
          </button>
        </div>

        <div class="subtitle">
          <span class="status" :class="statusClass">
            <span class="dot"></span>
            {{ statusText }}
          </span>
          <span class="sep">·</span>
          <span>{{ messageCount }} 条消息</span>
          <span class="sep hide-sm">·</span>
          <span class="model hide-sm" :style="{ color: session?.config ? 'var(--accent-1)' : '' }">
            {{ session?.config?.model || settings.model }}
          </span>
        </div>
      </div>
    </div>

    <div class="header-actions">
      <button type="button" class="icon-btn only-mobile" title="新建对话" @click="createSession()">
        <AppIcon name="plus" :size="19" />
      </button>

      <div ref="apiMenuRef" class="menu-wrap">
        <button type="button" class="icon-btn api-btn" :class="{ 'is-open': apiMenuOpen }" title="快速切换模板" @click="apiMenuOpen = !apiMenuOpen">
          <AppIcon name="cpu" :size="18" />
          <span class="api-label hide-sm">{{ currentApiLabel }}</span>
        </button>
        <Transition name="menu">
          <div v-if="apiMenuOpen" class="menu api-menu">
            <div class="menu-header">选择模型模板</div>
            <!-- 👈 核心修复 3：使用 @mousedown.prevent 替代 @click -->
            <button type="button" class="menu-item" @mousedown.prevent="changeApiPreset({ label: '跟随全局', value: null })">
              <AppIcon name="settings" :size="15" />
              默认 (跟随全局设置)
            </button>
            <div class="menu-divider"></div>
            <button v-for="preset in API_PRESETS" :key="preset.label" type="button" class="menu-item" @mousedown.prevent="changeApiPreset(preset)">
              <AppIcon name="zap" :size="15" style="color: var(--accent-1)" />
              {{ preset.label }}
            </button>
          </div>
        </Transition>
      </div>

      <div ref="menuRef" class="menu-wrap">
        <button type="button" class="icon-btn" :class="{ 'is-open': ui.exportOpen }" title="导出对话" @click="toggleExportMenu()">
          <AppIcon name="download" :size="18" />
        </button>
        <Transition name="menu">
          <div v-if="ui.exportOpen" class="menu">
            <button type="button" class="menu-item" @mousedown.prevent="doExport('md')"><AppIcon name="fileText" :size="15" /> 导出 Markdown</button>
            <button type="button" class="menu-item" @mousedown.prevent="doExport('json')"><AppIcon name="braces" :size="15" /> 导出 JSON</button>
            <div class="menu-divider"></div>
            <button type="button" class="menu-item" @mousedown.prevent="doExportAll"><AppIcon name="briefcase" :size="15" /> 导出全部对话</button>
          </div>
        </Transition>
      </div>

      <button type="button" class="icon-btn hide-xs" :title="themeTitle" @click="cycleTheme">
        <AppIcon :name="themeIcon" :size="18" />
      </button>

      <button type="button" class="icon-btn" title="设置" @click="openSettings">
        <AppIcon name="settings" :size="18" />
      </button>

      <!-- Electron 自绘窗口控制：最小化 / 最大化 / 关闭（浏览器中不渲染） -->
      <WindowControls />
    </div>
  </header>
</template>

<style scoped>
/* 保持原样 */
.chat-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: var(--header-h); padding: 0 18px 0 20px; flex: none; border-bottom: 1px solid var(--glass-border); }
.header-left { display: flex; align-items: center; gap: 11px; min-width: 0; }
.header-titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.title-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.title { font-size: 15px; font-weight: 640; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: min(46vw, 420px); cursor: text; border-radius: 6px; padding: 1px 4px; margin-left: -4px; transition: background 0.16s, color 0.16s; }
/* 角色名标签：替代原来 `标题 (角色名)` 的丑陋拼接。
   视觉上明显弱于标题（小字号 + 细边框 + 降饱和），不与会话名争夺注意力。 */
.role-badge { flex: none; max-width: 140px; padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 600; line-height: 1.5; color: var(--accent-2); background: rgba(34, 211, 238, 0.1); border: 1px solid rgba(34, 211, 238, 0.28); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 有角色标签时标题让出空间，优先保证标题可读；
   没有标签时保持原来的宽度，避免标题被无谓截断。 */
.title-row:has(.role-badge) .title { max-width: min(38vw, 340px); }
/* 双击可编辑的暗示：悬浮时轻微高亮，不让用户觉得只是个死标题 */
.title:hover { background: var(--glass-hover); }
.title:active { background: var(--glass-active); }
.title-edit { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; color: var(--faint); opacity: 0; transition: opacity 0.16s, color 0.16s, background 0.16s; }
.header-titles:hover .title-edit, .title-edit:focus-visible { opacity: 1; }
.title-edit:hover { color: var(--text); background: var(--glass-hover); }
.title-input { width: min(46vw, 380px); padding: 4px 8px; border-radius: 8px; font-size: 15px; font-weight: 620; color: var(--text-strong); background: var(--glass); border: 1px solid rgba(139, 92, 246, 0.5); outline: none; }
.subtitle { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--faint); min-width: 0; overflow: hidden; white-space: nowrap; }
.status { display: inline-flex; align-items: center; gap: 5px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--faint); box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.12); }
.status.is-online .dot { background: #34d399; box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.16); }
.status.is-offline .dot { background: #fb7185; box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.16); }
.status.is-streaming .dot { background: var(--accent-2); animation: blink 1s infinite; }
.status.is-idle .dot { background: #fbbf24; animation: blink 1.4s infinite; }
.model { font-family: var(--font-mono); font-size: 10.5px; padding: 0 5px; border-radius: 5px; border: 1px solid var(--glass-border); overflow: hidden; text-overflow: ellipsis; }
.sep { color: var(--glass-border-strong); }
.header-actions { display: flex; align-items: center; gap: 2px; flex: none; }
.icon-btn.is-open { color: var(--text); background: var(--glass-hover); border-color: var(--glass-border); }
.api-btn { display: flex; align-items: center; gap: 5px; width: auto; padding: 0 8px; }
.api-label { font-size: 11.5px; font-weight: 600; color: var(--accent-1); }
.api-menu { width: 170px; }
.menu-header { padding: 6px 10px; font-size: 11px; color: var(--faint); font-weight: 600; }
.menu-wrap { position: relative; }
.menu { position: absolute; top: calc(100% + 8px); right: 0; z-index: 30; width: 190px; padding: 6px; border-radius: 14px; background: var(--glass-strong); border: 1px solid var(--glass-border-strong); backdrop-filter: blur(22px) saturate(160%); -webkit-backdrop-filter: blur(22px) saturate(160%); box-shadow: var(--shadow-2); }
.menu-item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 9px; border-radius: 9px; font-size: 12.5px; color: var(--text); text-align: left; transition: background 0.15s, color 0.15s; }
.menu-item:hover { background: var(--glass-hover); }
.menu-divider { height: 1px; margin: 5px 4px; background: var(--glass-border); }
.menu-enter-active, .menu-leave-active { transition: opacity 0.16s var(--ease), transform 0.16s var(--ease); transform-origin: top right; }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(-4px) scale(0.97); }
.only-mobile { display: none; }

/* Electron 自绘标题栏：头部整条可拖动窗口，内部交互元素逐一豁免。
   .is-electron 类由 WindowControls 组件挂到 <html> 上，浏览器里不存在，零影响。 */
html.is-electron .chat-header { -webkit-app-region: drag; }
html.is-electron .chat-header button { -webkit-app-region: no-drag; }
html.is-electron .chat-header input { -webkit-app-region: no-drag; }
html.is-electron .chat-header .menu { -webkit-app-region: no-drag; }
/* 标题必须豁免拖拽，否则双击会被系统当成「最大化」手势，dblclick 收不到 */
html.is-electron .chat-header .title { -webkit-app-region: no-drag; }
@media (max-width: 980px) {
  .only-mobile { display: inline-grid; }
  .chat-header { padding: 0 10px 0 8px; }
  .title { max-width: 44vw; font-size: 14px; }
  .title-row:has(.role-badge) .title { max-width: 32vw; }
  .role-badge { max-width: 92px; font-size: 10px; padding: 0 6px; }
  .hide-sm { display: none; }
  .api-btn { padding: 0; width: 38px; justify-content: center; }
}
@media (max-width: 640px) { .hide-xs { display: none; } }
</style>