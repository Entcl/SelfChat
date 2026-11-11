<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { activeSession, chat, send, stop, updateSessionConfig } from '../store/chat'
import { settings, API_PRESETS } from '../store/settings'
import { toast } from '../store/toast'

const text = ref('')
const textareaRef = ref(null)

// 历史记录
const history = ref([])
const historyIndex = ref(-1)

// 下拉菜单状态
const dropdownOpen = ref(false)
const menuRef = ref(null)

// 当前使用的模型
const currentModel = computed(() => {
  return activeSession.value?.config?.model || settings.model
})

// 纯净展示：只显示模板里自带的模型
const availableModels = computed(() => {
  const isCloud = activeSession.value?.config?.protocol === 'openai' || (!activeSession.value?.config && settings.protocol === 'openai')
  
  if (isCloud) {
    const currentUrl = activeSession.value?.config?.baseUrl || settings.baseUrl
    const matchedPreset = API_PRESETS.find(p => p.value.baseUrl === currentUrl)
    return matchedPreset?.models || ['DeepSeek-V4.1-Flash', 'DeepSeek-V4-Pro']
  } else {
    const localPreset = API_PRESETS.find(p => p.value.protocol === 'ollama')
    return Array.from(new Set([...(settings.models || []), ...(localPreset?.models || [])])).filter(Boolean)
  }
})

// 切换具体模型
function applyModel(modelName) {
  if (!activeSession.value) return
  const baseConfig = activeSession.value.config || { ...settings }
  updateSessionConfig(activeSession.value.id, { ...baseConfig, model: modelName })
  dropdownOpen.value = false
  toast.success(`已切换至: ${modelName}`)
}

// 点击外部关闭下拉
function onDocPointerDown(e) {
  if (dropdownOpen.value && menuRef.value && !menuRef.value.contains(e.target)) {
    dropdownOpen.value = false
  }
}
onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown))

// ================= 输入框逻辑 =================
function adjustHeight() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}

async function submit() {
  const content = text.value.trim()
  if (!content || chat.streaming) return

  history.value.push(content)
  historyIndex.value = history.value.length

  text.value = ''
  await nextTick()
  adjustHeight()
  
  await send(content)
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
    return
  }

  if (e.key === 'ArrowUp' && !text.value && history.value.length > 0) {
    e.preventDefault()
    if (historyIndex.value > 0) historyIndex.value--
    text.value = history.value[historyIndex.value] || ''
    nextTick(() => textareaRef.value?.setSelectionRange(text.value.length, text.value.length))
  }
  
  if (e.key === 'ArrowDown' && !text.value && history.value.length > 0) {
    e.preventDefault()
    if (historyIndex.value < history.value.length - 1) {
      historyIndex.value++
      text.value = history.value[historyIndex.value] || ''
    } else {
      historyIndex.value = history.value.length
      text.value = ''
    }
  }
}

watch(text, () => nextTick(adjustHeight))
</script>

<template>
  <div class="composer">
    <div class="composer-box">
      <textarea
        ref="textareaRef"
        v-model="text"
        class="composer-input"
        rows="1"
        placeholder="输入消息，Shift + Enter 换行..."
        @keydown="onKeydown"
      ></textarea>

      <div class="composer-footer">
        <div class="composer-actions">
          <div class="model-selector" ref="menuRef">
            <button type="button" class="model-badge" :class="{ 'is-open': dropdownOpen }" @click="dropdownOpen = !dropdownOpen">
              <AppIcon name="cpu" :size="13" />
              <span>{{ currentModel }}</span>
              <AppIcon name="arrowDown" :size="12" class="arrow" />
            </button>
            
            <Transition name="menu">
              <div v-if="dropdownOpen" class="model-menu">
                <div class="menu-header">切换模型</div>
                <button v-for="model in availableModels" :key="model" type="button" class="menu-item model-item" @click="applyModel(model)">
                  <AppIcon name="box" :size="14" style="opacity: 0.5" />
                  <span class="model-name">{{ model }}</span>
                </button>
              </div>
            </Transition>
          </div>
        </div>

        <button v-if="chat.streaming" type="button" class="send-btn stop-btn" title="停止生成" @click="stop">
          <div class="stop-icon"></div>
        </button>
        <button v-else type="button" class="send-btn" title="发送消息" :disabled="!text.trim()" @click="submit">
          <AppIcon name="send" :size="18" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer { padding: 0 26px 22px; max-width: 860px; margin: 0 auto; width: 100%; }
.composer-box { display: flex; flex-direction: column; background: var(--glass); border: 1px solid var(--glass-border); border-radius: 20px; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); box-shadow: var(--shadow-1); transition: border-color 0.2s, box-shadow 0.2s; }
.composer-box:focus-within { border-color: rgba(139, 92, 246, 0.4); box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1), var(--shadow-1); }
.composer-input { width: 100%; max-height: 200px; padding: 16px 20px 8px; background: transparent; border: none; color: var(--text-strong); font-size: 14.5px; line-height: 1.6; resize: none; outline: none; }
.composer-input::placeholder { color: var(--faint); }
.composer-footer { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px 12px 16px; }
.composer-actions { display: flex; align-items: center; gap: 8px; }

.model-selector { position: relative; }
.model-badge { display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 8px; font-size: 11.5px; color: var(--muted); background: var(--glass-hover); border: 1px solid transparent; transition: all 0.15s; }
.model-badge:hover, .model-badge.is-open { color: var(--text-strong); border-color: var(--glass-border); background: var(--glass-strong); }
.model-badge .arrow { opacity: 0.6; transition: transform 0.2s; }
.model-badge.is-open .arrow { transform: rotate(180deg); }

.model-menu { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 50; width: 220px; max-height: 320px; overflow-y: auto; padding: 6px; border-radius: 14px; background: var(--glass-strong); border: 1px solid var(--glass-border-strong); box-shadow: var(--shadow-2); backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%); }
.menu-header { padding: 6px 10px; font-size: 11px; font-weight: 600; color: var(--faint); }
.menu-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border-radius: 8px; font-size: 12.5px; color: var(--text); text-align: left; transition: background 0.15s; }
.menu-item:hover { background: var(--glass-hover); }
.model-item { font-family: var(--font-mono); font-size: 11.5px; }
.model-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu-enter-active, .menu-leave-active { transition: opacity 0.15s, transform 0.15s; transform-origin: bottom left; }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(4px) scale(0.98); }

.send-btn { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: #fff; background: var(--accent-grad); transition: opacity 0.2s, transform 0.1s; flex: none; }
.send-btn:hover:not(:disabled) { transform: scale(1.05); }
.send-btn:disabled { opacity: 0.5; cursor: not-allowed; background: var(--glass-hover); color: var(--faint); }
.stop-btn { background: var(--glass-hover); border: 1px solid var(--glass-border); }
.stop-icon { width: 10px; height: 10px; border-radius: 2px; background: var(--text); }

@media (max-width: 980px) { .composer { padding: 0 14px 14px; } }
</style>