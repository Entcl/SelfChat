<script setup>
import AppIcon from './AppIcon.vue'
import { chat, send } from '../store/chat'
import { openSettings } from '../store/ui'

const suggestions = [
  {
    icon: 'braces',
    title: '写一段代码',
    desc: '用 Python 实现快速排序',
    prompt: '用 Python 实现快速排序，并逐行解释关键逻辑。',
  },
  {
    icon: 'fileText',
    title: '提炼要点',
    desc: '把长文压缩成清单',
    prompt: '请把我接下来粘贴的内容提炼成不超过 5 条的要点清单，并在末尾给出结论。',
  },
  {
    icon: 'sparkles',
    title: '解释概念',
    desc: '用类比讲清响应式原理',
    prompt: '用通俗的类比解释 Vue3 的响应式原理（Proxy 与依赖收集）。',
  },
  {
    icon: 'zap',
    title: '头脑风暴',
    desc: '周末一人食菜单',
    prompt: '给我一份周末一人食的三餐菜单，简单易做，并附上采购清单。',
  },
]

const pick = (prompt) => {
  if (chat.streaming) return
  send(prompt)
}
</script>

<template>
  <div class="empty-state">
    <div class="orb">
      <span class="orb-emoji">🐟</span>
    </div>

    <div class="empty-copy">
      <h1>今天想聊点什么？</h1>
      <p>本地模型已接入，所有对话都保存在这台设备上。</p>
    </div>

    <div class="suggestions">
      <button
        v-for="item in suggestions"
        :key="item.title"
        type="button"
        class="suggestion"
        @click="pick(item.prompt)"
      >
        <span class="suggestion-icon">
          <AppIcon :name="item.icon" :size="17" />
        </span>
        <span class="suggestion-text">
          <strong>{{ item.title }}</strong>
          <small>{{ item.desc }}</small>
        </span>
        <AppIcon name="chevronRight" :size="15" class="suggestion-arrow" />
      </button>
    </div>

    <button type="button" class="empty-link" @click="openSettings">
      <AppIcon name="settings" :size="14" />
      配置模型与接口
    </button>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 26px;
  min-height: 100%;
  padding: 40px 22px 60px;
  text-align: center;
  animation: fade-up 0.45s var(--ease) both;
}

.orb {
  position: relative;
  display: grid;
  place-items: center;
  width: 76px;
  height: 76px;
  border-radius: 26px;
  background: var(--accent-grad);
  box-shadow: var(--shadow-glow);
}

.orb::after {
  content: '';
  position: absolute;
  inset: -14px;
  border-radius: 34px;
  border: 1px solid var(--glass-border);
  background: var(--accent-grad-soft);
  filter: blur(2px);
  z-index: -1;
}

.orb-emoji {
  font-size: 34px;
  line-height: 1;
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.25));
}

.empty-copy h1 {
  font-size: clamp(22px, 3vw, 28px);
  letter-spacing: -0.02em;
}

.empty-copy p {
  margin-top: 8px;
  font-size: 13.5px;
  color: var(--muted);
}

.suggestions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: min(560px, 100%);
}

.suggestion {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 13px;
  border-radius: 14px;
  text-align: left;
  color: var(--text);
  background: var(--glass);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: transform 0.18s var(--ease), background 0.18s var(--ease),
    border-color 0.18s var(--ease), box-shadow 0.18s var(--ease);
}

.suggestion:hover {
  transform: translateY(-2px);
  background: var(--glass-hover);
  border-color: var(--glass-border-strong);
  box-shadow: var(--shadow-1);
}

.suggestion-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 10px;
  color: var(--accent-1);
  background: var(--accent-grad-soft);
  border: 1px solid var(--glass-border);
}

.suggestion-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.suggestion-text strong {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-strong);
}

.suggestion-text small {
  font-size: 11.5px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggestion-arrow {
  color: var(--faint);
  flex: none;
  transition: transform 0.18s var(--ease), color 0.18s;
}

.suggestion:hover .suggestion-arrow {
  color: var(--text);
  transform: translateX(2px);
}

.empty-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--muted);
  padding: 6px 12px;
  border-radius: 999px;
  transition: color 0.18s, background 0.18s;
}

.empty-link:hover {
  color: var(--text);
  background: var(--glass-hover);
}

@media (max-width: 560px) {
  .suggestions {
    grid-template-columns: minmax(0, 1fr);
  }

  .orb {
    width: 64px;
    height: 64px;
    border-radius: 22px;
  }

  .orb-emoji {
    font-size: 28px;
  }
}
</style>
