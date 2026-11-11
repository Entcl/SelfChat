import { reactive } from 'vue'

/** 轻量 UI 状态：抽屉、设置面板、搜索聚焦令牌 */
export const ui = reactive({
  drawer: false,
  settingsOpen: false,
  searchFocus: 0,
  exportOpen: false,
})

export function openSettings() {
  ui.settingsOpen = true
}

export function closeSettings() {
  ui.settingsOpen = false
}

export function openDrawer() {
  ui.drawer = true
}

export function closeDrawer() {
  ui.drawer = false
}

export function focusSearch() {
  ui.drawer = true
  ui.searchFocus += 1
}

export function toggleExportMenu(force) {
  ui.exportOpen = typeof force === 'boolean' ? force : !ui.exportOpen
}
