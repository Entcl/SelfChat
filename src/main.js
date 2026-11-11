import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { initChatStore } from './store/chat'
import { initUserStore } from './store/user'
import { initTheme } from './store/theme'
import { initSettings } from './store/settings'
import { migrateLocalStorage } from './utils/storage' // 👈 引入迁移函数

async function bootstrap() {
  // 1. 优先执行旧数据迁移
  await migrateLocalStorage()

  // 2. 加载各模块状态
  await Promise.all([
    initChatStore(),
    initUserStore(),
    initTheme(),
    initSettings()
  ])

  createApp(App).mount('#app')
}
bootstrap()