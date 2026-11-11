<script setup>
import { computed, nextTick, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import MarkdownBody from './MarkdownBody.vue'
import { chat, deleteMessage, editMessage, regenerate, retry } from '../store/chat'
import { copyText, formatClock } from '../utils/format'
import { toast } from '../store/toast'
import { userAvatar, aiAvatar, aiName, setUserAvatar, setAiAvatar, setAiName } from '../store/user'
import defaultUserAvatar from '../assets/batman.svg'
// 👈 引入 trumpIcon
import trumpIcon from '../assets/trumpIcon.svg'

const props = defineProps({
  message: { type: Object, required: true },
  isLast: { type: Boolean, default: false },
})

const isUser = computed(() => props.message.role === 'user')
const canRegenerate = computed(
  () => !isUser.value && props.isLast && !props.message.welcome && !chat.streaming,
)
const muted = computed(() => props.message.streaming && !props.message.content)

const editing = ref(false)
const draft = ref('')
const editRef = ref(null)

const userInput = ref(null)
const aiInput = ref(null)

const editingName = ref(false)
const nameDraft = ref('')
const nameRef = ref(null)

function startEditName() {
  if (isUser.value) return
  nameDraft.value = aiName.value
  editingName.value = true
  nextTick(() => {
    nameRef.value?.focus()
    nameRef.value?.select()
  })
}

function saveName() {
  if (!editingName.value) return
  editingName.value = false
  const val = nameDraft.value.trim()
  if (val && val !== aiName.value) {
    setAiName(val)
    toast.success('称呼已更新')
  }
}

function triggerUpload(isUserAvatar) {
  if (isUserAvatar) userInput.value?.click()
  else aiInput.value?.click()
}

function handleFileChange(e, isUserAvatar) {
  const file = e.target.files[0]
  if (!file) return
  if (file.size > 10 * 1024 * 1024) {
    toast.error('图片太大，请上传 10MB 以内的图片')
    return
  }
  const reader = new FileReader()
  reader.onload = (event) => {
    if (isUserAvatar) setUserAvatar(event.target.result)
    else setAiAvatar(event.target.result)
    toast.success('头像已更新')
  }
  reader.readAsDataURL(file)
  e.target.value = ''
}

async function copyMessage() {
  const ok = await copyText(props.message.content)
  toast[ok ? 'success' : 'error'](ok ? '已复制到剪贴板' : '复制失败')
}

function startEdit() {
  if (chat.streaming) return
  draft.value = props.message.content
  editing.value = true
  nextTick(() => {
    const el = editRef.value
    if (!el) return
    el.focus()
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    el.setSelectionRange(el.value.length, el.value.length)
  })
}

function cancelEdit() {
  editing.value = false
  draft.value = ''
}

async function saveEdit() {
  const content = draft.value.trim()
  if (!content) return
  editing.value = false
  await editMessage(props.message.id, content)
}

function onEditKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelEdit()
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    saveEdit()
  }
}

function onEditInput(event) {
  const el = event.target
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 240)}px`
}

function removeMessage() {
  if (chat.streaming) return
  deleteMessage(props.message.id)
  toast.info('消息已删除')
}

const statsText = computed(() => {
  const stats = props.message.stats
  if (!stats) return ''
  const parts = []
  if (stats.tps) parts.push(`${stats.tps} tok/s`)
  if (stats.ms) parts.push(`${(stats.ms / 1000).toFixed(1)}s`)
  return parts.join(' · ')
})
</script>

<template>
  <article class="msg" :class="[isUser ? 'is-user' : 'is-ai', { 'is-error': message.error }]">
    <input type="file" ref="userInput" accept="image/*" style="display: none" @change="handleFileChange($event, true)" />
    <input type="file" ref="aiInput" accept="image/*" style="display: none" @change="handleFileChange($event, false)" />

    <div class="avatar" :class="isUser ? 'avatar-user' : 'avatar-ai'" @click="triggerUpload(isUser)" title="点击更换头像">
      <template v-if="isUser">
        <img v-if="userAvatar" :src="userAvatar" class="avatar-img" alt="我" />
        <img v-else :src="defaultUserAvatar" class="avatar-img" alt="默认头像" />
      </template>
      <template v-else>
        <img v-if="aiAvatar" :src="aiAvatar" class="avatar-img" alt="AI" />
        <!-- 👈 修改：替换默认的“鱼”字 -->
        <img v-else :src="trumpIcon" class="avatar-img" alt="默认 AI 头像" />
      </template>
    </div>

    <div class="msg-main">
      <header class="msg-meta">
        <input
          v-if="!isUser && editingName"
          ref="nameRef"
          v-model="nameDraft"
          class="name-input"
          maxlength="16"
          @blur="saveName"
          @keydown.enter.prevent="saveName"
          @keydown.esc="editingName = false"
        />
        <span 
          v-else 
          class="msg-name" 
          :class="{ 'can-edit': !isUser }"
          :title="isUser ? '' : '点击修改称呼'"
          @click="startEditName"
        >
          {{ isUser ? '我' : aiName }}
        </span>
        
        <time class="msg-time">{{ formatClock(message.createdAt) }}</time>
        <span v-if="message.edited" class="msg-tag">已编辑</span>
        <span v-if="message.model && !isUser" class="msg-model">{{ message.model }}</span>
        <span v-if="statsText" class="msg-stat">{{ statsText }}</span>
      </header>

      <div v-if="editing" class="edit-box">
        <textarea ref="editRef" v-model="draft" class="edit-input" rows="2" @keydown="onEditKeydown" @input="onEditInput"></textarea>
        <div class="edit-actions">
          <button type="button" class="btn btn-sm" @click="cancelEdit">取消</button>
          <button type="button" class="btn btn-sm btn-primary" :disabled="!draft.trim()" @click="saveEdit">保存并重新发送</button>
        </div>
      </div>

      <template v-else>
        <div class="bubble" :class="isUser ? 'bubble-user' : 'bubble-ai'">
          <template v-if="muted">
            <span class="typing" aria-label="正在输入"><i></i><i></i><i></i></span>
          </template>
          <template v-else>
            <MarkdownBody v-if="message.content" :source="message.content" />
            <p v-if="message.aborted && !message.content" class="muted-note">已停止生成</p>
            <div v-if="message.error" class="error-box">
              <span class="error-icon"><AppIcon name="alert" :size="15" /></span>
              <div class="error-body">
                <p>{{ message.error }}</p>
                <button v-if="isLast" type="button" class="btn btn-sm" @click="retry"><AppIcon name="refresh" :size="13" /> 重试</button>
              </div>
            </div>
          </template>
        </div>

        <div class="msg-foot">
          <span v-if="message.streaming && message.content" class="streaming-hint">
            <span class="typing typing-sm"><i></i><i></i><i></i></span> 正在生成
          </span>
          <span v-else-if="message.aborted" class="muted-note">已手动停止</span>

          <div class="msg-actions">
            <button type="button" class="msg-act" title="复制内容" @click="copyMessage"><AppIcon name="copy" :size="14" /></button>
            <button v-if="isUser" type="button" class="msg-act" title="编辑并重新发送" @click="startEdit"><AppIcon name="edit" :size="14" /></button>
            <button v-if="canRegenerate" type="button" class="msg-act" title="重新生成回复" @click="regenerate"><AppIcon name="refresh" :size="14" /></button>
            <button v-if="!message.welcome" type="button" class="msg-act is-danger" title="删除这条消息" @click="removeMessage"><AppIcon name="trash" :size="14" /></button>
          </div>
        </div>
      </template>
    </div>
  </article>
</template>

<style scoped>
/* 样式保持原样，完全不用变 */
.msg-name.can-edit { cursor: pointer; transition: color 0.2s; }
.msg-name.can-edit:hover { color: var(--accent-1); text-decoration: underline; }
.name-input { font-size: 12px; font-weight: 620; color: var(--text-strong); background: var(--glass); border: 1px solid rgba(139, 92, 246, 0.5); border-radius: 4px; padding: 1px 6px; outline: none; width: 100px; box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.15); }
.avatar-img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
.avatar { display: grid; place-items: center; width: 34px; height: 34px; margin-top: 22px; flex: none; border-radius: 12px; font-size: 12.5px; font-weight: 650; color: #fff; border: 1px solid var(--glass-border); box-shadow: var(--shadow-1); overflow: hidden; cursor: pointer; transition: opacity 0.2s; }
.avatar:hover { opacity: 0.8; }
.avatar-user { background: #fff; }
.avatar-ai { background: var(--accent-grad); }
.avatar-mark { font-size: 15px; font-weight: 700; line-height: 1; color: #fff; }
.msg { display: flex; gap: 12px; width: 100%; max-width: 860px; margin: 0 auto; padding: 6px 0; animation: fade-up 0.32s var(--ease) both; }
.msg.is-user { flex-direction: row-reverse; }
.msg-main { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; max-width: min(700px, calc(100% - 46px)); }
.msg.is-user .msg-main { align-items: flex-end; }
.msg-meta { display: flex; align-items: center; gap: 8px; margin: 0 4px 5px; font-size: 11.5px; color: var(--faint); flex-wrap: wrap; }
.msg.is-user .msg-meta { justify-content: flex-end; }
.msg-name { font-size: 12px; font-weight: 620; color: var(--muted); }
.msg-model { padding: 0 6px; border-radius: 5px; background: var(--glass); border: 1px solid var(--glass-border); font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); }
.msg-tag { padding: 0 6px; border-radius: 5px; background: var(--accent-grad-soft); color: var(--muted); font-size: 10.5px; }
.msg-stat { font-family: var(--font-mono); font-size: 10.5px; color: var(--faint); }
.bubble { position: relative; min-width: 48px; max-width: 100%; padding: 11px 15px; border-radius: 16px; font-size: 14.8px; line-height: 1.72; overflow-wrap: anywhere; transition: background 0.2s, border-color 0.2s; }
.bubble-ai { color: var(--text); background: var(--bubble-ai); border: 1px solid var(--bubble-ai-border); border-top-left-radius: 6px; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.bubble-user { color: var(--user-text); background: var(--user-bubble); border: 1px solid rgba(255, 255, 255, 0.14); border-top-right-radius: 6px; box-shadow: var(--shadow-glow); }
.bubble-user :deep(.md-body) { color: var(--user-text); }
.bubble-user :deep(.md-body strong), .bubble-user :deep(.md-body h1), .bubble-user :deep(.md-body h2), .bubble-user :deep(.md-body h3), .bubble-user :deep(.md-body h4) { color: #fff; }
.bubble-user :deep(.md-body a) { color: #fff; border-bottom-color: rgba(255, 255, 255, 0.7); }
.bubble-user :deep(.md-body code.md-inline-code) { color: #fff; background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.28); }
.bubble-user :deep(.code-card) { background: rgba(6, 8, 16, 0.42); border-color: rgba(255, 255, 255, 0.2); }
.bubble-user :deep(.code-head) { background: rgba(255, 255, 255, 0.09); border-color: rgba(255, 255, 255, 0.18); }
.bubble-user :deep(.code-lang), .bubble-user :deep(.code-copy) { color: rgba(255, 255, 255, 0.78); }
.bubble-user :deep(.md-body blockquote) { color: rgba(255, 255, 255, 0.9); background: rgba(255, 255, 255, 0.13); border-left-color: rgba(255, 255, 255, 0.65); }
.bubble-user :deep(.md-body th) { background: rgba(255, 255, 255, 0.14); color: #fff; }
.bubble-user :deep(.md-body th), .bubble-user :deep(.md-body td) { border-color: rgba(255, 255, 255, 0.2); }
.bubble-user :deep(.md-table-wrap) { border-color: rgba(255, 255, 255, 0.2); }
.typing { display: inline-flex; align-items: center; gap: 4px; padding: 3px 0; }
.typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: typing-dot 1.1s infinite ease-in-out; }
.typing i:nth-child(2) { animation-delay: 0.16s; }
.typing i:nth-child(3) { animation-delay: 0.32s; }
.typing-sm i { width: 4px; height: 4px; }
.streaming-hint { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--faint); }
.muted-note { margin: 0; font-size: 12.5px; color: var(--faint); font-style: italic; }
.error-box { display: flex; gap: 9px; margin-top: 9px; padding: 9px 11px; border-radius: 11px; background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.28); color: #fca5a5; font-size: 12.5px; }
.msg.is-user .error-box { background: rgba(255, 255, 255, 0.16); border-color: rgba(255, 255, 255, 0.3); color: #fff; }
.error-icon { flex: none; margin-top: 1px; }
.error-body { display: flex; flex-direction: column; gap: 7px; align-items: flex-start; }
.error-body .btn { color: var(--text); background: var(--glass-hover); }
.msg-foot { display: flex; align-items: center; gap: 8px; min-height: 22px; margin-top: 3px; padding: 0 2px; }
.msg.is-user .msg-foot { justify-content: flex-end; }
.msg-actions { display: flex; gap: 2px; opacity: 0; transform: translateY(-2px); transition: opacity 0.18s var(--ease), transform 0.18s var(--ease); }
.msg:hover .msg-actions, .msg:focus-within .msg-actions { opacity: 1; transform: none; }
.msg-act { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; color: var(--faint); border: 1px solid transparent; transition: all 0.16s var(--ease); }
.msg-act:hover { color: var(--text); background: var(--glass-hover); border-color: var(--glass-border); }
.msg-act.is-danger:hover { color: #f87171; background: rgba(248, 113, 113, 0.12); border-color: rgba(248, 113, 113, 0.28); }
.edit-box { width: min(640px, 100%); display: flex; flex-direction: column; gap: 8px; }
.edit-input { width: 100%; resize: none; padding: 11px 13px; border-radius: 14px; background: var(--glass); border: 1px solid rgba(139, 92, 246, 0.45); color: var(--text); font-size: 14px; line-height: 1.6; outline: none; box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.12); }
.edit-actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (hover: none) { .msg-actions { opacity: 1; transform: none; } }
@media (max-width: 640px) {
  .msg { gap: 9px; }
  .avatar { width: 30px; height: 30px; border-radius: 10px; margin-top: 20px; font-size: 11.5px; }
  .bubble { padding: 10px 13px; font-size: 14.5px; }
  .msg-main { max-width: calc(100% - 40px); }
  .msg-model { display: none; }
}
</style>