import { computed, reactive, watch } from 'vue'
import { loadRaw, saveRaw } from '../utils/storage'

const STORAGE_KEY = 'sc.theme.v1'
const THEME_COLORS = { dark: '#070810', light: '#eef1f9' }

// 先给默认值
export const theme = reactive({
  mode: 'dark',
})

// 👈 新增：异步初始化函数
export async function initTheme() {
  const stored = await loadRaw(STORAGE_KEY, 'dark')
  if (['dark', 'light', 'system'].includes(stored)) {
    theme.mode = stored
  }
}

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null

export const resolvedTheme = computed(() => {
  if (theme.mode === 'system') return media?.matches ? 'light' : 'dark'
  return theme.mode
})

function applyTheme() {
  if (typeof document === 'undefined') return
  const value = resolvedTheme.value
  document.documentElement.dataset.theme = value
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[value])
  saveRaw(STORAGE_KEY, theme.mode) // 因为 saveRaw 是异步的，这里不用 await，静默保存即可
}

watch(resolvedTheme, applyTheme, { immediate: true })
watch(() => theme.mode, applyTheme)

media?.addEventListener?.('change', () => {
  if (theme.mode === 'system') applyTheme()
})

export function setTheme(mode) {
  if (['dark', 'light', 'system'].includes(mode)) theme.mode = mode
}

export function cycleTheme() {
  theme.mode = theme.mode === 'dark' ? 'light' : theme.mode === 'light' ? 'system' : 'dark'
}