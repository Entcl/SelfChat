const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')

// 引入后端服务（内部会设置 DB_PATH 并打开 SQLite）
require('../server/index.js')

// 与后端共用同一个 better-sqlite3 实例（require 缓存）
const { getKV, setKV } = require('../server/db')

const APP_URL = 'http://127.0.0.1:3000'

// ================= IPC：KV 存储 =================
// 渲染进程通过 preload 暴露的 electronAPI 调用，避免开启 nodeIntegration
ipcMain.handle('kv:get', (_event, key) => {
  try {
    return getKV(key)
  } catch (err) {
    console.error('[IPC] kv:get 失败:', err.message)
    return null
  }
})

ipcMain.handle('kv:set', (_event, key, value) => {
  try {
    return setKV(key, value)
  } catch (err) {
    console.error('[IPC] kv:set 失败:', err.message)
    return false
  }
})

ipcMain.handle('app:info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
  userData: app.getPath('userData'),
}))

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'SelfChat - 大肥鱼 AI 工作台',
    autoHideMenuBar: true,
    backgroundColor: '#070810',
    // 指定窗口左上角图标
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 安全基线：渲染进程不直接接触 Node，能力经由 preload 白名单暴露
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })

  // 站外链接交给系统浏览器，不在应用内新开窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 阻止渲染进程被导航到本地服务之外的地址
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) event.preventDefault()
  })

  // 加载本地服务
  win.loadURL(APP_URL)
}

app.whenReady().then(createWindow)

// 强制退出，防止安装时冲突
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    BrowserWindow.getAllWindows().forEach((win) => win.destroy())
    app.quit()
  }
})
