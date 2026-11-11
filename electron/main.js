const { app, BrowserWindow } = require('electron')
const path = require('path')

// 引入后端服务
require('../server/index.js')

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "SelfChat - 大肥鱼 AI 工作台",
    autoHideMenuBar: true,
    // 指定窗口左上角图标
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  // 加载本地服务
  win.loadURL('http://127.0.0.1:3000')
}

app.whenReady().then(createWindow)

// 强制退出，防止安装时冲突
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    BrowserWindow.getAllWindows().forEach(win => win.destroy())
    app.quit()
  }
})