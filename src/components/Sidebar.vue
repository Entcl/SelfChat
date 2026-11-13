<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { activeSession, chat, createSession, deleteSession, renameSession, selectSession, togglePin, visibleSessions } from '../store/chat'
import { askConfirm } from '../store/confirm'
import { closeDrawer, focusSearch, openDrawer, ui } from '../store/ui'
import { toast } from '../store/toast'
import { aiName, currentProviderType, updateName } from '../store/user'
import { hasWorkspace, workspaceId } from '../utils/storage'
import AiAvatar from './AiAvatar.vue'

const searchRef = ref(null)
const searchText = ref('')
const editingId = ref(null)
const editDraft = ref('')
const editRef = ref(null)

// 工作区编号只取数字部分，展示成 #1 / #2，比 w1 / w2 更好懂
const workspaceLabel = computed(() => workspaceId.replace(/^w/, ''))
const canOpenWindow = Boolean(hasWorkspace && typeof window !== 'undefined' && window.electronAPI?.workspaces)

async function openNewWindow() {
  try {
    await window.electronAPI.workspaces.create()
  } catch (err) {
    toast.error('新建窗口失败：' + (err?.message || err))
  }
}

const isSearching = computed(() => Boolean(searchText.value.trim()))

const filteredSessions = computed(() => {
  // 👈 只取当前服务类型（本地 / 云端）的历史，两个维度不再互相串
  let list = visibleSessions.value
  const keyword = searchText.value.trim().toLowerCase()
  if (keyword) {
    list = list.filter(s => 
      s.title.toLowerCase().includes(keyword) || 
      s.messages.some(m => m.content.toLowerCase().includes(keyword))
    )
  }
  
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
})

function formatTime(ts) {
  if (!ts) return ''
  const date = new Date(ts)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  
  if (isToday) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }
  return `${date.getMonth() + 1}/${date.getDate()}`
}

watch(() => ui.searchFocus, async () => {
  await nextTick()
  searchRef.value?.focus()
})

function onSearch() {
  if (isSearching.value && filteredSessions.value.length > 0) {
    selectSession(filteredSessions.value[0].id)
  }
}

async function startRename(session) {
  editingId.value = session.id
  editDraft.value = session.title
  await nextTick()
  editRef.value?.focus()
  editRef.value?.select()
}

function commitRename() {
  if (!editingId.value) return
  const session = chat.sessions.find(s => s.id === editingId.value)
  if (session) renameSession(session.id, editDraft.value)
  editingId.value = null
}

function onRenameKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitRename()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    editingId.value = null
  }
}

async function onDelete(session) {
  const ok = await askConfirm({
    title: '删除对话？',
    message: `确定要删除「${session.title}」吗？该操作无法恢复。`,
    confirmText: '删除',
  })
  if (ok) {
    deleteSession(session.id)
    toast.success('对话已删除')
  }
}

function newChat() {
  createSession()
  searchText.value = ''
}

/* ── AI 名字原地编辑 ──────────────────────────────────────────
 * 点击「本地大肥鱼」这类标题直接变成输入框。
 * 只改当前 provider 那一份（currentProviderType 由 user store 按会话判定），
 * 因此本地窗口改名不会波及云端窗口。
 */
const editingName = ref(false)
const nameDraft = ref('')
const nameInputRef = ref(null)

async function startEditName() {
  if (editingName.value) return
  nameDraft.value = aiName.value || ''
  editingName.value = true
  await nextTick()
  nameInputRef.value?.focus()
  nameInputRef.value?.select()
}

/** 提交改名；空白时回落到默认名（updateName 内部已处理） */
function commitName() {
  if (!editingName.value) return
  editingName.value = false
  const next = nameDraft.value.trim()
  // 名字没变就不写库，省一次 SQLite 往返
  if (next === (aiName.value || '')) return
  updateName(currentProviderType.value, next)
  toast.success('名字已更新')
}

/** Esc 取消：只退出编辑态，不落盘 */
function cancelName() {
  editingName.value = false
  nameDraft.value = ''
}

function onNameKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitName()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelName()
  }
}

onMounted(() => {})
</script>

<template>
  <aside class="sidebar" :class="{ 'is-open': ui.drawer }">
    <header class="sidebar-header">
      <div class="logo-area">
        <AiAvatar size="sidebar" editable resettable />
        <div class="logo-text">
          <!-- 点击原地改名：@click.stop 防止冒泡到外层可点击区域 -->
          <input
            v-if="editingName"
            ref="nameInputRef"
            v-model="nameDraft"
            class="name-input"
            type="text"
            maxlength="24"
            @click.stop
            @keydown="onNameKeydown"
            @blur="commitName"
          />
          <h1
            v-else
            class="name-text"
            title="点击修改名字"
            @click.stop="startEditName"
          >{{ aiName || '大肥鱼' }}</h1>
          <p>AI 对话工作台</p>
        </div>
      </div>
      <button type="button" class="icon-btn close-drawer" @click="closeDrawer">
        <AppIcon name="x" :size="20" />
      </button>
    </header>

    <div class="sidebar-actions">
      <button type="button" class="btn btn-primary new-chat-btn" @click="newChat">
        <AppIcon name="plus" :size="16" />
        新建对话
      </button>
      <button
        v-if="canOpenWindow"
        type="button"
        class="icon-btn new-window-btn"
        title="新建窗口（独立配置与聊天记录）"
        @click="openNewWindow"
      >
        <AppIcon name="window" :size="17" />
      </button>
    </div>

    <!-- 当前窗口是哪个工作区：多窗口并存时用户需要一眼分清 -->
    <div v-if="canOpenWindow" class="workspace-tag" :title="`当前窗口独立工作区：${workspaceId}`">
      <span class="ws-dot"></span>
      工作区 #{{ workspaceLabel }}
    </div>

    <div class="search-box">
      <AppIcon name="search" :size="14" class="search-icon" />
      <input
        ref="searchRef"
        v-model="searchText"
        type="text"
        placeholder="搜索对话内容..."
        class="search-input"
        @keydown.enter="onSearch"
      />
      <button v-if="searchText" type="button" class="clear-btn" @click="searchText = ''">
        <AppIcon name="x" :size="12" />
      </button>
    </div>

    <div class="session-list">
      <div v-if="filteredSessions.length === 0" class="empty-tip">
        没有找到相关对话
      </div>

      <div
        v-for="session in filteredSessions"
        :key="session.id"
        class="session-item"
        :class="{ 'is-active': session.id === chat.activeId, 'is-pinned': session.pinned }"
        @click="selectSession(session.id)"
      >
        <!-- 当前选中的会话显示 AI 头像，与左上角/气泡保持同一来源；
             其余会话仍用轻量图标，避免列表里重复出现同一个头像。 -->
        <AiAvatar
          v-if="session.id === chat.activeId"
          size="session"
          class="session-avatar"
        />
        <div v-else class="session-icon">
          <AppIcon :name="session.pinned ? 'pin' : 'message'" :size="14" />
        </div>
        
        <div class="session-content">
          <input
            v-if="editingId === session.id"
            ref="editRef"
            v-model="editDraft"
            class="rename-input"
            @blur="commitRename"
            @keydown="onRenameKeydown"
            @click.stop
          />
          <div v-else class="session-title" :title="session.title">
            {{ session.title }}
          </div>
          <div class="session-time">{{ formatTime(session.updatedAt) }}</div>
        </div>

        <div class="session-actions" @click.stop>
          <button
            type="button"
            class="action-btn"
            :class="{ 'is-active': session.pinned }"
            :title="session.pinned ? '取消置顶' : '置顶'"
            @click="togglePin(session.id)"
          >
            <AppIcon name="pin" :size="12" />
          </button>
          <button
            type="button"
            class="action-btn"
            title="重命名"
            @click="startRename(session)"
          >
            <AppIcon name="edit" :size="12" />
          </button>
          <button
            type="button"
            class="action-btn is-danger"
            title="删除"
            @click="onDelete(session)"
          >
            <AppIcon name="trash" :size="12" />
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* 样式保持原样 */
.sidebar { display: flex; flex-direction: column; width: 260px; height: 100%; background: var(--sidebar-bg, rgba(15, 23, 42, 0.6)); border-right: 1px solid var(--glass-border); flex: none; }
.sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 18px; border-bottom: 1px solid var(--glass-border); }
.logo-area { display: flex; align-items: center; gap: 12px; }
.logo-area { display: flex; align-items: center; gap: 11px; min-width: 0; }
.logo-text h1 { font-size: 15px; font-weight: 700; color: var(--text-strong); line-height: 1.2; }
.logo-text p { font-size: 11px; color: var(--muted); margin-top: 2px; }

/* ── AI 名字：可点击原地编辑 ── */
.name-text {
  display: inline-block;
  max-width: 100%;
  padding: 1px 5px;
  margin: -1px -5px;
  border-radius: 6px;
  cursor: text;
  transition: background 0.16s var(--ease), box-shadow 0.16s var(--ease);
}
/* 悬停给一点底色 + 虚下划线，暗示「这里可以点」 */
.name-text:hover {
  background: var(--glass-hover);
  box-shadow: inset 0 -1px 0 var(--accent-1);
}
.name-text:active { background: var(--glass-active); }

.name-input {
  width: 100%;
  min-width: 0;
  padding: 1px 5px;
  margin: -1px -5px;
  font-size: 15px;
  font-weight: 700;
  font-family: inherit;
  color: var(--text-strong);
  line-height: 1.2;
  background: var(--glass-hover);
  border: 1px solid var(--accent-1);
  border-radius: 6px;
  outline: none;
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.16);
}
.close-drawer { display: none; }
.sidebar-actions { padding: 16px 14px 8px; display: flex; align-items: center; gap: 8px; }
.new-chat-btn { flex: 1 1 auto; min-width: 0; height: 36px; justify-content: center; border-radius: 10px; font-size: 13px; }
/* 新建窗口：与主按钮同一行，视觉上明显次要 */
.new-window-btn { flex: none; width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--glass-border); color: var(--muted); }
.new-window-btn:hover { color: var(--accent-2); border-color: rgba(34, 211, 238, 0.42); background: rgba(34, 211, 238, 0.1); }
/* 工作区标识：常驻小字，提醒用户当前窗口的数据是独立的一份 */
.workspace-tag { display: flex; align-items: center; gap: 6px; margin: 0 14px 10px; padding: 0 8px; height: 22px; font-size: 10.5px; font-weight: 600; color: var(--faint); letter-spacing: 0.02em; }
.ws-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent-2); box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.14); }
.search-box { position: relative; display: flex; align-items: center; margin: 8px 14px 12px; padding: 0 10px; height: 32px; background: var(--glass); border: 1px solid var(--glass-border); border-radius: 8px; transition: border-color 0.2s; }
.search-box:focus-within { border-color: rgba(139, 92, 246, 0.5); }
.search-icon { color: var(--faint); }
.search-input { flex: 1; min-width: 0; border: none; background: transparent; padding: 0 8px; font-size: 12px; color: var(--text); outline: none; }
.search-input::placeholder { color: var(--faint); }
.clear-btn { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; background: var(--glass-hover); color: var(--muted); }
.clear-btn:hover { color: var(--text); }
.session-list { flex: 1; overflow-y: auto; padding: 0 10px 16px; display: flex; flex-direction: column; gap: 2px; }
.empty-tip { text-align: center; font-size: 12px; color: var(--faint); padding: 20px 0; }
.session-item { display: flex; align-items: center; padding: 10px; border-radius: 10px; cursor: pointer; border: 1px solid transparent; transition: all 0.15s; }
.session-item:hover { background: var(--glass-hover); }
.session-item.is-active { background: var(--glass-strong); border-color: var(--glass-border); box-shadow: var(--shadow-1); }
.session-icon { display: grid; place-items: center; color: var(--faint); margin-right: 10px; flex: none; }
/* AiAvatar 的根元素会带上本组件传入的 class，但 scoped 样式需 :deep 才能命中 */
.session-item :deep(.session-avatar) { margin-right: 10px; }
.session-item.is-active .session-icon { color: var(--accent-1); }
.session-item.is-pinned .session-icon { color: #fbbf24; }
.session-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.session-title { font-size: 13px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-item.is-active .session-title { font-weight: 600; color: var(--text-strong); }
.rename-input { font-size: 13px; font-weight: 500; color: var(--text-strong); background: var(--glass); border: 1px solid var(--accent-1); border-radius: 4px; padding: 2px 6px; outline: none; width: 100%; }
.session-time { font-size: 10.5px; color: var(--faint); }
.session-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; }
.session-item:hover .session-actions { opacity: 1; }
.action-btn { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; color: var(--faint); transition: all 0.15s; }
.action-btn:hover { background: var(--glass-strong); color: var(--text); }
.action-btn.is-active { color: #fbbf24; }
.action-btn.is-danger:hover { background: rgba(248, 113, 113, 0.1); color: #f87171; }
@media (max-width: 980px) {
  .sidebar { position: fixed; top: 0; left: 0; bottom: 0; z-index: 100; transform: translateX(-100%); transition: transform 0.28s var(--ease); background: var(--panel-bg); box-shadow: var(--shadow-2);
    /* 小屏适配：不超过屏幕宽度的 86%，避免在 320px 设备上铺满 */
    width: min(260px, 86vw);
    /* 刘海屏安全区：抽屉贴着屏幕边缘，需要避开圆角与指示条 */
    padding-left: env(safe-area-inset-left);
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .sidebar.is-open { transform: translateX(0); }
  .close-drawer { display: grid; }
  /* 抽屉内滚动区域禁止穿透滚动到页面 */
  .session-list { overscroll-behavior: contain; }
}
</style>