<script setup>
import { nextTick, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { confirmState, settleConfirm } from '../store/confirm'

const confirmRef = ref(null)

watch(
  () => confirmState.open,
  async (open) => {
    if (!open) return
    await nextTick()
    confirmRef.value?.focus()
  },
)

function cancel() {
  settleConfirm(false)
}

function accept() {
  settleConfirm(true)
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  } else if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    accept()
  }
}
</script>

<template>
  <Transition name="dialog">
    <div v-if="confirmState.open" class="confirm-layer" @click.self="cancel" @keydown="onKeydown">
      <div class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="confirm-icon" :class="{ 'is-danger': confirmState.danger }">
          <AppIcon :name="confirmState.danger ? 'alert' : 'sparkles'" :size="19" />
        </div>
        <h2 id="confirm-title" class="confirm-title">{{ confirmState.title }}</h2>
        <p v-if="confirmState.message" class="confirm-message">{{ confirmState.message }}</p>
        <div class="confirm-actions">
          <button ref="confirmRef" type="button" class="btn" @click="cancel">取消</button>
          <button
            type="button"
            class="btn"
            :class="confirmState.danger ? 'btn-danger' : 'btn-primary'"
            @click="accept"
          >
            {{ confirmState.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.confirm-layer {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--overlay);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.confirm-card {
  width: min(360px, 100%);
  padding: 22px;
  border-radius: 20px;
  background: var(--panel-bg);
  border: 1px solid var(--glass-border-strong);
  box-shadow: var(--shadow-2);
  animation: fade-up 0.26s var(--ease) both;
}

.confirm-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  margin-bottom: 14px;
  border-radius: 13px;
  color: var(--accent-1);
  background: var(--accent-grad-soft);
  border: 1px solid var(--glass-border);
}

.confirm-icon.is-danger {
  color: #fb7185;
  background: rgba(251, 113, 133, 0.13);
  border-color: rgba(251, 113, 133, 0.26);
}

.confirm-title {
  font-size: 16.5px;
}

.confirm-message {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted);
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  margin-top: 20px;
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s var(--ease);
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-active .confirm-card {
  transition: transform 0.24s var(--ease-spring);
}

.dialog-enter-from .confirm-card {
  transform: scale(0.95);
}
</style>
