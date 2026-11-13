import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { initChatStore } from './store/chat'
import { initUserStore } from './store/user'
import { initTheme } from './store/theme'
import { initSettings } from './store/settings'
import { adoptLegacyKeys, migrateLocalStorage } from './utils/storage' // 👈 引入迁移函数

async function bootstrap() {
  // 1. 优先执行旧数据迁移
  await migrateLocalStorage()

  // 2. 把改造前「无命名空间」的旧数据收编到当前窗口的工作区，
  //    否则老用户升级后会觉得历史记录凭空消失了
  await adoptLegacyKeys()

  // 3. 先加载设置：chat / user 都依赖 settings.protocol 判断当前是本地还是云端，
  //    如果并行初始化，settings 还是默认的 ollama，
  //    会把本该属于云端的会话标成 local —— 顺序不能换。
  await initSettings()

  await Promise.all([
    initChatStore(),
    initUserStore(),
    initTheme(),
  ])

  createApp(App).mount('#app')

  registerServiceWorker()
}

// 注册 Service Worker（PWA 安装 + 静态资源缓存）
// 仅在生产构建且非 Electron 环境下注册：
// - 开发时注册会干扰 Vite HMR
// - Electron 里页面来自本地 http://127.0.0.1，SW 无意义且可能缓存旧壳
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return
  // Electron 里页面来自本地 http://127.0.0.1，SW 无意义且可能缓存旧壳
  if (window.electronAPI) return
  if (navigator.userAgent.includes('Electron')) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(new URL('sw.js', document.baseURI).href, { scope: './' })
      .catch((err) => {
        // 注册失败不影响应用本身
        console.warn('[PWA] Service Worker 注册失败:', err?.message || err)
      })
  })
}

bootstrap()