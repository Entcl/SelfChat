import { reactive } from 'vue'

/** 轻量 UI 状态：抽屉、设置面板、AdShield 控制台、搜索聚焦令牌 */
export const ui = reactive({
  drawer: false,
  settingsOpen: false,
  // AdShield 控制台现在是「设置 → 插件管理 → EXE 插件」卡片打开的模态弹窗，
  // 因此它必须能与 settingsOpen 同时为 true（弹窗嵌套），不能互斥。
  adshieldOpen: false,
  // 当前打开的 EXE 插件 id（预留：将来接第二个 exe 插件时区分是谁打开的）
  activeExePlugin: '',
  searchFocus: 0,
  exportOpen: false,
  /**
   * 「聚焦 API Key」信号令牌。
   *
   * 用自增计数而非 boolean，有三个好处：
   *   1. 连点两次同一预设也能再次触发（boolean 第二次没有变化，watch 不响应）
   *   2. 天然支持「面板已经开着」的情况 —— 不需要先关再开
   *   3. 消费方拿到令牌后无需手动重置，避免了「忘记清零导致每次都抢焦点」的经典 bug
   *      （需求里提到的 needFocusApiKey = false 清理，用令牌模式从根上不需要）
   */
  apiKeyFocus: 0,
})

export function openSettings() {
  ui.settingsOpen = true
  // 只关掉抽屉，不动 adshieldOpen：从设置里打开的控制台要能留在设置之上
  ui.drawer = false
}

export function closeSettings() {
  ui.settingsOpen = false
  // 设置关掉时，挂在它上面打开的控制台也要一起收起，避免留下孤儿弹窗
  ui.adshieldOpen = false
  ui.activeExePlugin = ''
}

/** 打开 AdShield 操作控制台（可从设置面板内打开，叠在设置之上） */
export function openAdShield(pluginId = '') {
  ui.adshieldOpen = true
  ui.activeExePlugin = pluginId
  ui.drawer = false
}

export function closeAdShield() {
  ui.adshieldOpen = false
  ui.activeExePlugin = ''
}

export function toggleAdShield() {
  if (ui.adshieldOpen) closeAdShield()
  else openAdShield()
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

/**
 * 打开设置面板并请求聚焦 API Key 输入框。
 *
 * 调用方（顶部「选择模型模板」下拉）只负责发出意图，
 * 真正的 DOM 聚焦由 SettingsPanel 自己监听 ui.apiKeyFocus 完成 ——
 * 因为只有它知道面板动画要多久、输入框在哪个 Tab 下。
 */
export function focusApiKey() {
  openSettings()
  ui.apiKeyFocus += 1
}
