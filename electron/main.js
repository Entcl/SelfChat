const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')

/**
 * 单实例锁必须在 require('../server/index.js') 之前拿到。
 * 后端模块在加载时就会 app.listen(3000)，第二个进程先抢端口会直接抛错，
 * 用户看到的就是「双击图标打不开」而不是「多出一个窗口」。
 */
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 已有实例在跑：立刻退出，「再点一次图标」的请求交给 second-instance 转成新窗口
  app.quit()
} else {
  bootstrap()
}

function bootstrap() {
  // 引入后端服务（内部会设置 DB_PATH 并打开 SQLite）
  require('../server/index.js')

  // 与后端共用同一个 better-sqlite3 实例（require 缓存）
  const { getKV, setKV } = require('../server/db')

  const APP_URL = 'http://127.0.0.1:3000'

  // ================= 多窗口 = 多工作区 =================
  // 一个窗口对应一个「工作区」：一个独立的 Chromium 分区 + 一个独立的存储命名空间。
  // 工作区 id 必须**稳定**。用 Date.now() 会每次启动都生成新分区，
  // 用户重启后历史记录全部消失 —— 那是最坏的一种「隔离」。
  const REGISTRY_KEY = 'sc.workspaces.v1'
  const DEFAULT_WORKSPACE = 'w1'

  /** workspace id -> BrowserWindow */
  const windowsByWorkspace = new Map()
  /** webContents.id -> workspace id（兜底查找用） */
  const workspaceByWebContents = new Map()

  function loadRegistry() {
    try {
      const raw = getKV(REGISTRY_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const ids = Array.isArray(parsed?.ids)
        ? parsed.ids.map((v) => String(v)).filter((v) => /^w\d+$/.test(v))
        : []
      if (ids.length) {
        const unique = [...new Set(ids)]
        const open = Math.min(Math.max(Number(parsed?.open) || 1, 1), unique.length)
        return { ids: unique, open }
      }
    } catch (err) {
      console.error('[Window] 读取工作区注册表失败:', err.message)
    }
    return { ids: [DEFAULT_WORKSPACE], open: 1 }
  }

  function saveRegistry() {
    try {
      setKV(REGISTRY_KEY, JSON.stringify(registry))
    } catch (err) {
      console.error('[Window] 保存工作区注册表失败:', err.message)
    }
  }

  /** { ids: ['w1','w2'], open: 2 } —— ids 是全部工作区，open 是下次启动恢复几个窗口 */
  let registry = loadRegistry()

  function pickWorkspaceId() {
    const inUse = new Set(windowsByWorkspace.keys())
    // 优先复用「以前开过但当前没开」的工作区，这样关掉再打开还是原来的数据
    const reusable = registry.ids.find((id) => !inUse.has(id))
    if (reusable) return reusable
    let n = 1
    while (registry.ids.includes(`w${n}`)) n += 1
    const id = `w${n}`
    registry.ids.push(id)
    return id
  }

  function workspaceOf(event) {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && win.__scWorkspaceId) return win.__scWorkspaceId
    return workspaceByWebContents.get(event.sender.id) || ''
  }

  // ================= IPC：工作区 =================
  ipcMain.on('workspace:sync-id', (event) => {
    // preload 启动时同步索取，保证渲染进程在读第一份存储前就拿到 id
    event.returnValue = workspaceOf(event)
  })

  ipcMain.handle('workspace:current', (event) => workspaceOf(event))

  ipcMain.handle('workspace:new', () => {
    const win = createWindow()
    return win?.__scWorkspaceId || null
  })

  ipcMain.handle('workspace:list', () =>
    registry.ids.map((id) => {
      const win = windowsByWorkspace.get(id)
      return {
        id,
        // 注册表里登记过就算「已存在」，只是当前没开窗而已。
        // 直接返回 open:false 会让渲染进程误以为这个工作区不存在。
        exists: true,
        open: Boolean(win && !win.isDestroyed()),
        focused: Boolean(win && !win.isDestroyed() && win.isFocused()),
      }
    }),
  )

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

  ipcMain.handle('app:info', (event) => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData'),
    workspaceId: workspaceOf(event),
  }))

  // ================= IPC：窗口控制（自绘标题栏） =================
  // titleBarStyle: 'hidden' 之后，最小化/最大化/关闭由渲染进程的
  // WindowControls 组件发起，这里只做白名单式的动作转发。
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on('window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  function createWindow(workspaceId) {
    const id = workspaceId || pickWorkspaceId()

    const alive = windowsByWorkspace.get(id)
    if (alive && !alive.isDestroyed()) {
      if (alive.isMinimized()) alive.restore()
      alive.focus()
      return alive
    }

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      // 标题带上工作区编号：多窗口并存时，任务栏 / Alt+Tab 里能一眼分清是哪一个
      title: `SelfChat - 大肥鱼 AI 工作台 · 工作区 ${id.replace(/^w/, '#')}`,
      autoHideMenuBar: true,
      // Windows 下隐藏原生标题栏，由应用内自绘细线条窗口控制按钮；
      // 保留系统边框（可拖拽调整大小、Win11 圆角）。macOS 继续用原生红绿灯。
      titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
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
        // 👇 物理隔离：每个工作区一个持久化分区。
        //    localStorage / sessionStorage / IndexedDB / cookie 互不可见，
        //    persist: 前缀保证重启后分区内容仍在。
        partition: `persist:window-${id}`,
        // 👇 把工作区 id 同步注入渲染进程（preload 读 process.argv）
        additionalArguments: [`--sc-workspace=${id}`],
        // 说明：additionalArguments 在部分沙箱/打包组合下不会透传到 process.argv，
        // 因此真正的兜底是下面的 URL 查询参数 —— 它是同步可读、无 IPC 依赖的。
      },
    })

    win.__scWorkspaceId = id
    const wcId = win.webContents.id
    windowsByWorkspace.set(id, win)
    workspaceByWebContents.set(wcId, id)
    registry.open = windowsByWorkspace.size
    saveRegistry()

    // 最大化状态变化时同步给渲染进程（自绘按钮据此切换图标）
    const sendMaxState = () => win.webContents.send('window:maximized-changed', win.isMaximized())
    win.on('maximize', sendMaxState)
    win.on('unmaximize', sendMaxState)

    win.on('closed', () => {
      // 注意：'closed' 触发后 webContents 已销毁，不能再读 win.webContents.id
      workspaceByWebContents.delete(wcId)
      if (windowsByWorkspace.get(id) === win) windowsByWorkspace.delete(id)
      registry.open = Math.max(windowsByWorkspace.size, 1)
      saveRegistry()
    })

    // 阻止页面的 <title> 覆盖我们带工作区编号的窗口标题。
    // 自绘标题栏看不到它，但任务栏 / Alt+Tab / 窗口列表里需要靠它区分窗口。
    win.on('page-title-updated', (event) => {
      event.preventDefault()
      win.setTitle(`SelfChat - 大肥鱼 AI 工作台 · 工作区 ${id.replace(/^w/, '#')}`)
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

    // 加载本地服务。
    // 👇 工作区 id 用 URL 查询参数传递，这是整条链路里最可靠的一环：
    //    同步可读、不依赖 process.argv、不依赖 IPC 往返，
    //    渲染进程启动第一行就能拿到，不存在「读晚了退化成 w1」的窗口期。
    win.loadURL(`${APP_URL}/?sc-workspace=${id}`)

    return win
  }

  // 再次双击图标 / 从开始菜单再点一次 → 在同一进程内新开一个隔离窗口
  app.on('second-instance', () => {
    createWindow()
  })

  app.whenReady().then(() => {
    const restore = Math.min(Math.max(registry.open, 1), registry.ids.length)
    for (let i = 0; i < restore; i += 1) createWindow(registry.ids[i])
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // 强制退出，防止安装时冲突
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      BrowserWindow.getAllWindows().forEach((win) => win.destroy())
      app.quit()
    }
  })
}
