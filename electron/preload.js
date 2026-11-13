/**
 * 预加载脚本：在 contextIsolation 开启的前提下，
 * 通过 contextBridge 向渲染进程暴露一组最小化的、白名单式的 API。
 *
 * 注意：这里刻意不暴露 require / ipcRenderer 本身，
 * 只暴露具体的方法，避免渲染进程获得任意 Node 能力。
 */
const { contextBridge, ipcRenderer } = require('electron')

/**
 * 当前窗口的工作区 id（如 "w1"）。
 *
 * 主进程创建窗口时通过 additionalArguments 注入 `--sc-workspace=w1`，
 * 这里直接从 process.argv 读取 —— 同步、零 IPC 往返。
 * 渲染进程在 initChatStore() 之前就需要它来做 key 命名空间，
 * 所以不能用异步 invoke。
 */
function readWorkspaceId() {
  const hit = (process.argv || []).find((arg) => arg.startsWith('--sc-workspace='))
  const fromArgv = hit ? hit.slice('--sc-workspace='.length) : ''
  if (fromArgv) return fromArgv
  // 兜底：argv 拿不到时同步问主进程（sendSync 保证仍是同步语义）
  try {
    return ipcRenderer.sendSync('workspace:sync-id') || ''
  } catch {
    return ''
  }
}

const workspaceId = readWorkspaceId()

contextBridge.exposeInMainWorld('electronAPI', {
  /** 当前窗口的工作区 id，存储层据此给每个 key 加命名空间 */
  workspaceId,

  /** 读取 KV 存储，键不存在时返回 null */
  dbGet: (key) => ipcRenderer.invoke('kv:get', String(key)),
  /** 写入 KV 存储；value 传 null 表示删除该键 */
  dbSet: (key, value) => ipcRenderer.invoke('kv:set', String(key), value === null || value === undefined ? null : String(value)),
  /** 应用元信息，便于渲染进程判断运行环境 */
  appInfo: () => ipcRenderer.invoke('app:info'),

  /** 多工作区（多窗口）管理 */
  workspaces: {
    /** 当前窗口的工作区 id */
    current: () => ipcRenderer.invoke('workspace:current'),
    /** 新开一个隔离窗口，返回它的工作区 id */
    create: () => ipcRenderer.invoke('workspace:new'),
    /** 列出全部工作区及其开关状态 */
    list: () => ipcRenderer.invoke('workspace:list'),
  },

  /** 自绘标题栏的窗口控制（仅 Electron 环境下存在） */
  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    /** 订阅最大化状态变化，返回取消订阅函数 */
    onMaximizeChange: (callback) => {
      const handler = (_event, value) => callback(value)
      ipcRenderer.on('window:maximized-changed', handler)
      return () => ipcRenderer.removeListener('window:maximized-changed', handler)
    },
  },
})
