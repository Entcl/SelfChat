<script setup>
import AppIcon from './AppIcon.vue'
import { toasts } from '../store/toast'

const ICON = { success: 'check', error: 'alert', info: 'sparkles' }
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="item in toasts" :key="item.id" class="toast" :class="`is-${item.type}`">
        <span class="toast-icon">
          <AppIcon :name="ICON[item.type] || 'sparkles'" :size="15" />
        </span>
        <span class="toast-text">{{ item.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  left: 50%;
  top: 84px;
  transform: translateX(-50%);
  z-index: 90;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  padding: 0 16px;
  width: min(440px, 100%);
}

.toast {
  display: flex;
  align-items: center;
  gap: 9px;
  max-width: 100%;
  padding: 9px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--text);
  background: var(--glass-strong);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  box-shadow: var(--shadow-2);
  pointer-events: auto;
}

.toast-icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  flex: none;
  color: var(--accent-1);
  background: var(--accent-grad-soft);
}

.toast.is-success .toast-icon {
  color: #34d399;
  background: rgba(52, 211, 153, 0.14);
}

.toast.is-error .toast-icon {
  color: #fb7185;
  background: rgba(251, 113, 133, 0.14);
}

.toast-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.24s var(--ease), transform 0.24s var(--ease);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.97);
}

.toast-move {
  transition: transform 0.24s var(--ease);
}

@media (max-width: 980px) {
  .toast-host {
    top: 76px;
    width: 100%;
  }

  .toast {
    font-size: 12.5px;
  }
}
</style>
