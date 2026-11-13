<script setup>
/**
 * 自绘窗口控制按钮（最小化 / 最大化 / 关闭）
 *
 * - 仅在 Electron + Windows 环境渲染；浏览器里什么都不输出
 * - 图标为 1px 细线 SVG（fill="none"），不用图标字体
 * - 颜色全部走主题变量：深色主题下是浅灰细线，浅色主题下是深灰细线，
 *   与图一「极简扁平细线条」风格一致，无需为两套主题分别写样式
 * - 最大化后自动切换为「向下还原」双框图标
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const api = typeof window !== 'undefined' ? window.electronAPI : null
// macOS 保留原生红绿灯按钮，避免出现两套控制按钮
const available = !!api?.windowControls && !/Mac/i.test(navigator.platform || '')

const maximized = ref(false)
let unsubscribe = null

onMounted(async () => {
  if (!available) return
  // 通知全局 CSS：当前运行在 Electron 里（头部拖动区、按钮豁免都依赖它）
  document.documentElement.classList.add('is-electron')
  try {
    maximized.value = await api.windowControls.isMaximized()
  } catch {}
  unsubscribe = api.windowControls.onMaximizeChange((value) => {
    maximized.value = !!value
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
  document.documentElement.classList.remove('is-electron')
})
</script>

<template>
  <div v-if="available" class="window-controls">
    <button
      type="button"
      class="wc-btn"
      title="最小化"
      aria-label="最小化"
      @click="api.windowControls.minimize()"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3 7h8" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
      </svg>
    </button>

    <button
      type="button"
      class="wc-btn"
      :title="maximized ? '向下还原' : '最大化'"
      :aria-label="maximized ? '向下还原' : '最大化'"
      @click="api.windowControls.toggleMaximize()"
    >
      <!-- 最大化状态：双框「还原」图标 -->
      <svg v-if="maximized" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="2.5" y="5" width="6.5" height="6.5" stroke="currentColor" stroke-width="1" />
        <path
          d="M5 5V2.5h6.5V9"
          stroke="currentColor"
          stroke-width="1"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <!-- 普通状态：无圆角空心正方形 -->
      <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="3.5" y="3.5" width="7" height="7" stroke="currentColor" stroke-width="1" />
      </svg>
    </button>

    <button
      type="button"
      class="wc-btn wc-close"
      title="关闭"
      aria-label="关闭"
      @click="api.windowControls.close()"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5"
          stroke="currentColor"
          stroke-width="1"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: 10px;
}

/* 透明背景、无边框无阴影；图标颜色跟随主题变量 */
.wc-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  /* 头部是拖动区，按钮必须豁免，否则点不到 */
  -webkit-app-region: no-drag;
  transition: background 0.15s var(--ease), color 0.15s var(--ease);
}

.wc-btn:hover {
  background: rgba(255, 255, 255, 0.09);
  color: var(--text-strong);
}

html[data-theme='light'] .wc-btn:hover {
  background: rgba(15, 23, 42, 0.06);
}

.wc-btn:active {
  background: rgba(255, 255, 255, 0.14);
}

html[data-theme='light'] .wc-btn:active {
  background: rgba(15, 23, 42, 0.1);
}

/* 关闭按钮：悬停微红 */
.wc-close:hover {
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
}

.wc-close:active {
  background: rgba(239, 68, 68, 0.24);
  color: #dc2626;
}

.wc-btn:focus-visible {
  outline: 1px solid var(--accent-1);
  outline-offset: 1px;
}

/* 窗口缩到较窄时收紧间距，防止头部溢出换行 */
@media (max-width: 720px) {
  .window-controls {
    gap: 4px;
    margin-left: 2px;
  }

  .wc-btn {
    width: 26px;
    height: 26px;
  }
}
</style>
