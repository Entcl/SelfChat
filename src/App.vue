<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import AdShieldPanel from './components/AdShieldPanel.vue'
import ChatHeader from './components/ChatHeader.vue'
import Composer from './components/Composer.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import MessageList from './components/MessageList.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import Sidebar from './components/Sidebar.vue'
import ToastHost from './components/ToastHost.vue'
import { activeSession, chat, checkStatus, createSession, stop } from './store/chat'
import { closeAdShield, closeDrawer, closeSettings, focusSearch, openSettings, toggleAdShield, toggleExportMenu, ui } from './store/ui'
import { toast } from './store/toast'
import { exportSession } from './utils/export'

function onKeydown(event) {
  const mod = event.ctrlKey || event.metaKey
  const key = String(event.key || '').toLowerCase()

  if (mod && !event.shiftKey && key === 'n') {
    event.preventDefault()
    createSession()
    return
  }
  if (mod && !event.shiftKey && key === 'k') {
    event.preventDefault()
    focusSearch()
    return
  }
  if (mod && key === ',') {
    event.preventDefault()
    openSettings()
    return
  }
  // Ctrl/Cmd + Shift + A：唤起 AdShield 激活码生成器
  if (mod && event.shiftKey && key === 'a') {
    event.preventDefault()
    toggleAdShield()
    return
  }
  if (mod && event.shiftKey && key === 'e') {
    event.preventDefault()
    if (activeSession.value?.messages.length) {
      exportSession(activeSession.value, 'md')
      toast.success('已导出当前对话')
    } else {
      toast.info('当前对话还没有内容')
    }
    return
  }
  if (event.key === 'Escape') {
    // 层级从高到低：AdShield 控制台叠在设置面板之上，所以先关它
    if (ui.adshieldOpen) {
      closeAdShield()
      return
    }
    if (ui.settingsOpen) {
      closeSettings()
      return
    }
    if (ui.exportOpen) {
      toggleExportMenu(false)
      return
    }
    if (ui.drawer) {
      closeDrawer()
      return
    }
    if (chat.streaming) {
      stop()
      toast.info('已停止生成')
    }
  }
}

onMounted(() => {
  checkStatus()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app">
    <div class="app-bg" aria-hidden="true">
      <span class="blob blob-1"></span>
      <span class="blob blob-2"></span>
      <span class="blob blob-3"></span>
      <span class="grid"></span>
    </div>

    <div class="app-shell">
      <Transition name="mask">
        <div v-if="ui.drawer" class="drawer-mask" @click="closeDrawer"></div>
      </Transition>

      <Sidebar />

      <main class="chat-panel">
        <ChatHeader />
        <MessageList />
        <Composer />
      </main>
    </div>

    <!-- 层级：SettingsPanel(80) → AdShieldPanel(120)；
         AdShield 用 Teleport 挂到 body，DOM 顺序不影响层叠，z-index 才是决定性的 -->
    <SettingsPanel :open="ui.settingsOpen" />
    <AdShieldPanel :open="ui.adshieldOpen" @close="closeAdShield" />
    <ConfirmDialog />
    <ToastHost />
  </div>
</template>

<style scoped>
.app {
  position: relative;
  height: 100vh;
  height: 100dvh;
  width: 100%;
  overflow: hidden;
  background: var(--bg);
}

.app-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: var(--blob-opacity);
  will-change: transform;
}

.blob-1 {
  width: 56vmax;
  height: 56vmax;
  top: -20vmax;
  left: -14vmax;
  background: radial-gradient(circle at 35% 35%, #7c3aed 0%, rgba(124, 58, 237, 0.35) 45%, transparent 70%);
  animation: blob-drift 28s ease-in-out infinite alternate;
}

.blob-2 {
  width: 46vmax;
  height: 46vmax;
  top: -8vmax;
  right: -14vmax;
  background: radial-gradient(circle at 50% 50%, #0891b2 0%, rgba(8, 145, 178, 0.32) 48%, transparent 72%);
  animation: blob-drift 34s ease-in-out infinite alternate-reverse;
}

.blob-3 {
  width: 42vmax;
  height: 42vmax;
  bottom: -18vmax;
  left: 28%;
  background: radial-gradient(circle at 50% 50%, #db2777 0%, rgba(219, 39, 119, 0.28) 46%, transparent 70%);
  animation: blob-drift 40s ease-in-out infinite alternate;
}

.grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(var(--grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size: 46px 46px;
  mask-image: radial-gradient(circle at 50% 38%, #000 0%, transparent 82%);
  -webkit-mask-image: radial-gradient(circle at 50% 38%, #000 0%, transparent 82%);
}

.app-shell {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 14px;
  height: 100%;
  padding: 14px;
}

.chat-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100%;
  border-radius: var(--radius-lg);
  background: var(--glass);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}

.chat-panel::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(139, 92, 246, 0.5), rgba(34, 211, 238, 0.42), transparent);
  pointer-events: none;
}

.drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: var(--overlay);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

@media (min-width: 981px) {
  .drawer-mask {
    display: none;
  }
}

.mask-enter-active,
.mask-leave-active {
  transition: opacity 0.24s var(--ease);
}

.mask-enter-from,
.mask-leave-to {
  opacity: 0;
}

@media (max-width: 980px) {
  .app-shell {
    padding: 0;
    gap: 0;
  }

  .chat-panel {
    border-radius: 0;
    border: none;
    box-shadow: none;
  }

  .blob {
    filter: blur(70px);
  }
}
</style>
