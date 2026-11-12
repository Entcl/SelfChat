/**
 * 预加载脚本：在 contextIsolation 开启的前提下，
 * 通过 contextBridge 向渲染进程暴露一组最小化的、白名单式的 API。
 *
 * 注意：这里刻意不暴露 require / ipcRenderer 本身，
 * 只暴露具体的方法，避免渲染进程获得任意 Node 能力。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  /** 读取 KV 存储，键不存在时返回 null */
  dbGet: (key) => ipcRenderer.invoke('kv:get', String(key)),
  /** 写入 KV 存储；value 传 null 表示删除该键 */
  dbSet: (key, value) => ipcRenderer.invoke('kv:set', String(key), value === null || value === undefined ? null : String(value)),
  /** 应用元信息，便于渲染进程判断运行环境 */
  appInfo: () => ipcRenderer.invoke('app:info'),
})
