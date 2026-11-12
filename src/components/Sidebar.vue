<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { activeSession, chat, createSession, deleteSession, renameSession, selectSession, togglePin } from '../store/chat'
import { askConfirm } from '../store/confirm'
import { closeDrawer, focusSearch, openDrawer, ui } from '../store/ui'
import { toast } from '../store/toast'
import { aiAvatar, aiName } from '../store/user'
// 👈 引入 trumpIcon
import trumpIcon from '../assets/trumpIcon.svg'

const searchRef = ref(null)
const searchText = ref('')
const editingId = ref(null)
const editDraft = ref('')
const editRef = ref(null)

const isSearching = computed(() => Boolean(searchText.value.trim()))

const filteredSessions = computed(() => {
  let list = chat.sessions
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

onMounted(() => {})
</script>

<template>
  <aside class="sidebar" :class="{ 'is-open': ui.drawer }">
    <header class="sidebar-header">
      <div class="logo-area">
        <div class="logo-icon">
          <img v-if="aiAvatar" :src="aiAvatar" class="logo-img" alt="AI" />
          <!-- 👈 修改：替换默认的“鱼”字 -->
          <img v-else :src="trumpIcon" class="logo-img" alt="默认 AI" />
        </div>
        <div class="logo-text">
          <h1>{{ aiName || '大肥鱼' }}</h1>
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
        <div class="session-icon">
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
.logo-icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; background: var(--accent-grad); color: #fff; font-size: 18px; font-weight: 700; flex: none; overflow: hidden; box-shadow: var(--shadow-glow); }
.logo-img { width: 100%; height: 100%; object-fit: cover; }
.logo-text h1 { font-size: 15px; font-weight: 700; color: var(--text-strong); line-height: 1.2; }
.logo-text p { font-size: 11px; color: var(--muted); margin-top: 2px; }
.close-drawer { display: none; }
.sidebar-actions { padding: 16px 14px 8px; }
.new-chat-btn { width: 100%; height: 36px; justify-content: center; border-radius: 10px; font-size: 13px; }
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
  .sidebar { position: fixed; top: 0; left: 0; bottom: 0; z-index: 100; transform: translateX(-100%); transition: transform 0.28s var(--ease); background: var(--panel-bg); box-shadow: var(--shadow-2); }
  .sidebar.is-open { transform: translateX(0); }
  .close-drawer { display: grid; }
}
</style>