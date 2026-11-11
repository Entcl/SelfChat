<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import EmptyState from './EmptyState.vue'
import MessageBubble from './MessageBubble.vue'
import { activeSession, chat } from '../store/chat'

const box = ref(null)
const atBottom = ref(true)
const unseen = ref(0)
let lastLength = 0

const messages = computed(() => activeSession.value?.messages ?? [])

const signature = computed(() => {
  const session = activeSession.value
  if (!session) return ''
  const last = session.messages[session.messages.length - 1]
  return `${session.id}|${session.messages.length}|${last?.content.length ?? 0}`
})

function distanceToBottom() {
  const el = box.value
  if (!el) return 0
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

function onScroll() {
  atBottom.value = distanceToBottom() < 90
  if (atBottom.value) unseen.value = 0
}

function scrollToBottom(behavior = 'auto') {
  const el = box.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior })
  atBottom.value = true
  unseen.value = 0
}

function jumpToBottom() {
  scrollToBottom('smooth')
}

watch(
  signature,
  async () => {
    const length = messages.value.length
    if (length > lastLength && !atBottom.value) unseen.value += length - lastLength
    lastLength = length
    if (atBottom.value) {
      await nextTick()
      scrollToBottom('auto')
    }
  },
  { flush: 'post' },
)

watch(
  () => chat.activeId,
  async () => {
    unseen.value = 0
    atBottom.value = true
    lastLength = messages.value.length
    await nextTick()
    scrollToBottom('auto')
  },
)

onMounted(async () => {
  lastLength = messages.value.length
  await nextTick()
  scrollToBottom('auto')
})
</script>

<template>
  <main ref="box" class="messages" role="log" aria-live="polite" @scroll.passive="onScroll">
    <div class="messages-inner">
      <EmptyState v-if="!messages.length" />
      <template v-else>
        <MessageBubble
          v-for="(message, index) in messages"
          :key="message.id"
          :message="message"
          :is-last="index === messages.length - 1"
        />
        <div class="list-tail"></div>
      </template>
    </div>

    <Transition name="jump">
      <button v-if="!atBottom" type="button" class="jump-btn" title="回到最新消息" @click="jumpToBottom">
        <AppIcon name="arrowDown" :size="16" />
        <span v-if="unseen > 0" class="jump-count">{{ unseen }}</span>
      </button>
    </Transition>
  </main>
</template>

<style scoped>
.messages {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scroll-behavior: auto;
  padding: 22px 26px 8px;
}

.messages-inner {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.list-tail {
  flex: none;
  height: 12px;
}

.jump-btn {
  position: sticky;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  margin: 0 auto;
  border-radius: 999px;
  font-size: 12px;
  color: var(--text);
  background: var(--glass-strong);
  border: 1px solid var(--glass-border-strong);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: var(--shadow-2);
  transition: transform 0.18s var(--ease), background 0.18s;
  z-index: 5;
}

.jump-btn:hover {
  transform: translateX(-50%) translateY(-2px);
  background: var(--glass-hover);
}

.jump-count {
  display: grid;
  place-items: center;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: var(--accent-grad);
}

.jump-enter-active,
.jump-leave-active {
  transition: opacity 0.2s var(--ease), transform 0.2s var(--ease);
}

.jump-enter-from,
.jump-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

@media (max-width: 980px) {
  .messages {
    padding: 16px 14px 6px;
  }
}
</style>
