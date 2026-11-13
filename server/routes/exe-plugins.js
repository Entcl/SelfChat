/**
 * server/routes/exe-plugins.js
 * ============================================================
 * EXE 插件扫描与清单
 *
 * 背景：server/plugins（以及 userData/plugins）下同时存在两类东西：
 *   1. JS 插件      —— 目录里有 main.js / index.js，或单个 .js 文件
 *   2. EXE 插件     —— 目录里是一个编译好的 .exe（PyInstaller 产物，含 _internal/）
 *
 * 两类产物形态完全不同，混在一个列表里前端无法区分。这个模块负责：
 *   - 给 scanPlugins（JS 插件扫描器）提供「这个条目是不是 EXE 插件」的判定
 *   - 独立扫描出 EXE 插件清单，供 GET /api/plugins/exe 使用
 *
 * 判定规则（顺序很重要）：
 *   a) 目录名本身以 .exe 结尾        → EXE 插件（极少数把 exe 当目录名的情况）
 *   b) 文件名以 .exe 结尾            → EXE 插件
 *   c) 目录内含 _internal/ 子目录    → EXE 插件（PyInstaller onedir 的固定标志）
 *   d) 目录内直接躺着 .exe 文件      → EXE 插件（onefile 散放）
 *
 * 注意：c/d 必须在 JS 插件的 main.js 判定之前执行，
 * 否则一个同时带 main.js 和 .exe 的目录会被误分类。
 * ============================================================
 */

const fs = require('fs')
const path = require('path')

// PyInstaller onedir 一定会生成这个目录名
const PYINSTALLER_INTERNAL_DIR = '_internal'

/**
 * 粗判 exe 是否为 PyInstaller 产物（用于展示「打包方式」这类信息）。
 *
 * 为什么不能看 PE 头：所有 Windows exe 都是 "MZ" 开头的 PE 文件，
 * PyInstaller 的产物也不例外，仅凭 PE 头无法区分。
 * PyInstaller 的 bootloader 会在文件尾部写入带 "MEI" 标识的归档，
 * 所以这里扫文件尾部一小段找这个标记。
 *
 * @param {string} exePath
 * @returns {'pyinstaller' | 'unknown'}
 */
function guessExeKind(exePath) {
  try {
    const stat = fs.statSync(exePath)
    const probeSize = Math.min(4096, stat.size)
    const fd = fs.openSync(exePath, 'r')
    const buf = Buffer.alloc(probeSize)
    // 归档标记在文件末尾附近，读最后 4KB 比读全文件便宜得多
    fs.readSync(fd, buf, 0, probeSize, Math.max(0, stat.size - probeSize))
    fs.closeSync(fd)
    return buf.includes('MEI') ? 'pyinstaller' : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * 列出一个目录下所有 .exe 文件（不递归进 _internal，避免扫上千个 DLL）。
 * @param {string} dir
 * @returns {string[]} 绝对路径
 */
function listExeFiles(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.exe'))
      .map((d) => path.join(dir, d.name))
  } catch {
    return []
  }
}

/**
 * 判断插件根目录下的某个「顶层条目」是不是 EXE 插件。
 * 这个函数同时被 server/index.js 的 scanPlugins 和本模块的扫描逻辑复用，
 * 保证「普通插件列表」和「EXE 插件列表」不会出现同一个条目。
 *
 * @param {string} root       插件根目录
 * @param {string} entryName  顶层条目名（文件或目录名）
 * @returns {{ isExe: boolean, reason: string }}
 */
function isExePluginEntry(root, entryName) {
  const lower = String(entryName || '').toLowerCase()

  // a) 孤立的 .exe 文件：**不算 EXE 插件入口**。
  //
  // 为什么不再把裸 exe 当插件：单文件版（--onefile）和目录版（--onedir）
  // 混在一起时，同一个插件会出现两张卡片（9.6MB 的 exe + 23.1MB 的目录）。
  // 现在只支持 onedir 一种形态，裸 exe 一律视为「历史上传残留」，
  // 不进入任何插件列表；它仍会被 server/index.js 当作需要提示清理的垃圾。
  if (lower.endsWith('.exe')) {
    return { isExe: false, reason: 'standalone-exe-ignored' }
  }

  const fullPath = path.join(root, entryName)
  let stat
  try {
    stat = fs.statSync(fullPath)
  } catch {
    return { isExe: false, reason: 'stat-failed' }
  }

  // 不是目录就肯定不是 EXE 插件（普通 .js 文件交给原逻辑）
  if (!stat.isDirectory()) {
    return { isExe: false, reason: 'not-directory' }
  }

  // c) 含 _internal/ —— PyInstaller onedir 的强特征
  const internalPath = path.join(fullPath, PYINSTALLER_INTERNAL_DIR)
  try {
    if (fs.statSync(internalPath).isDirectory()) {
      return { isExe: true, reason: 'pyinstaller-internal' }
    }
  } catch {
    // 没有 _internal，继续看下一条件
  }

  // d) 目录里直接有 .exe 文件（onedir 但恰好没生成 _internal 的旧版本）
  if (listExeFiles(fullPath).length > 0) {
    return { isExe: true, reason: 'contains-exe' }
  }

  return { isExe: false, reason: 'javascript-plugin' }
}

/**
 * 判断某个条目是否是「应当被忽略的裸 exe 文件」。
 * server/index.js 用它来跳过这些文件（既不进 JS 插件列表，也不进 EXE 插件列表）。
 */
function isStandaloneExeFile(root, entryName) {
  const lower = String(entryName || '').toLowerCase()
  if (!lower.endsWith('.exe')) return false
  try {
    return fs.statSync(path.join(root, entryName)).isFile()
  } catch {
    return false
  }
}

/**
 * 统计目录总大小（递归，但跳过 _internal 内部的深度遍历开销可接受，
 * 因为 onedir 的 _internal 一般几百个文件、几十 MB，同步遍历一次是毫秒级）。
 * @param {string} target 文件或目录
 * @param {number} depth
 * @returns {number} 字节数
 */
function computeSize(target, depth = 0) {
  if (depth > 8) return 0
  let stat
  try {
    stat = fs.statSync(target)
  } catch {
    return 0
  }
  if (stat.isFile()) return stat.size

  let total = 0
  let entries = []
  try {
    entries = fs.readdirSync(target, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const p = path.join(target, e.name)
    if (e.isFile()) {
      try {
        total += fs.statSync(p).size
      } catch {
        // 无权限的文件跳过
      }
    } else if (e.isDirectory()) {
      total += computeSize(p, depth + 1)
    }
  }
  return total
}

/** 人类可读大小 */
function formatBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * 扫描一个插件根目录下的所有 EXE 插件。
 *
 * @param {string} root        插件根目录
 * @param {object} configMap   插件配置（按目录名索引）
 * @returns {Array<object>} EXE 插件清单
 */
function scanExePluginsIn(root, configMap) {
  const result = []
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return result
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    // _internal 是别人的附属目录，本身不是插件
    if (entry.name === PYINSTALLER_INTERNAL_DIR) continue
    // 只认目录：孤立的 .exe 文件不是插件（见 isExePluginEntry 的说明）
    if (!entry.isDirectory()) continue

    const verdict = isExePluginEntry(root, entry.name)
    if (!verdict.isExe) continue

    const fullPath = path.join(root, entry.name)

    // 定位真正的 exe
    const exes = listExeFiles(fullPath)
    if (exes.length === 0) continue
    // 同目录多个 exe 时，优先选和目录同名的那个
    const baseName = entry.name.toLowerCase()
    const exePath =
      exes.find((p) => path.basename(p, '.exe').toLowerCase() === baseName) || exes[0]
    // 走到这里一定是目录，layout 统一是 onedir（单文件形态已被排除）
    const layout = 'onedir'

    // 配置读取（兼容旧版布尔值）
    const saved = configMap?.[entry.name]
    let enabled = false
    let alias = ''
    if (typeof saved === 'boolean') {
      enabled = saved
    } else if (saved && typeof saved === 'object') {
      enabled = Boolean(saved.enabled)
      alias = String(saved.alias || '')
    }

    const size = computeSize(fullPath)
    const dirName = entry.name

    result.push({
      // id 用目录名，和普通插件的 id 规则保持一致
      id: dirName,
      name: dirName,
      displayName: alias || dirName,
      alias,
      version: '1.0.0',
      desc: 'PyInstaller 目录版可执行插件',
      enabled,
      type: 'exe',
      layout,
      exePath,
      dirPath: fullPath,
      exists: true,
      size,
      sizeHuman: formatBytes(size),
      // 前端据此渲染 .exe 角标
      badge: 'EXE',
      reason: verdict.reason,
    })
  }

  result.sort((a, b) => a.displayName.localeCompare(b.displayName))
  return result
}

/**
 * 计算「插件身份」用于去重。
 *
 * 为什么不直接用目录名：同一个插件的目录名会随历史演进变化
 * （AdShield → adshield_exe），目录名不同但其实是同一个程序。
 * 用 exe 文件名（去掉 .exe、转小写）作为身份，才能把旧目录和新目录识别为同一个。
 *
 * @param {object} item
 * @returns {string}
 */
function identityOf(item) {
  const exeBase = item.exePath
    ? path.basename(item.exePath).replace(/\.exe$/i, '').toLowerCase()
    : ''
  if (exeBase) return exeBase
  // 兜底：目录名转小写
  return String(item.id || item.name || '').toLowerCase()
}

/**
 * 扫描多个插件根目录，合并去重。
 *
 * 去重规则：
 *   1. 身份相同的条目只保留一个（身份 = exe 文件名去扩展名转小写，
 *      所以 AdShield/AdShield.exe 和 adshield_exe/AdShield.exe 视为同一个）
 *   2. 选择优先级（高者胜出）：
 *      a. 在内置目录（roots 里靠后的、随应用发布的那个）里存在的
 *         —— 这样 userData 里的历史残留不会盖住当前正确版本
 *      b. 目录名与 exe 名完全一致的（adshield_exe 这种规范命名）
 *         —— 避免老的 AdShield/ 抢占
 *      c. 目录名里带下划线的（adshield_exe 比 AdShield 更符合当前命名约定）
 *      d. 先扫到的
 *
 * @param {string[]} roots 按优先级从高到低（userData 在前、内置目录在后）
 * @param {object} configMap
 */
function scanExePlugins(roots, configMap) {
  /** @type {Map<string, {item: object, root: string, rootIndex: number}>} */
  const merged = new Map()

  roots.forEach((root, rootIndex) => {
    for (const item of scanExePluginsIn(root, configMap)) {
      const key = identityOf(item)
      const prev = merged.get(key)

      if (!prev) {
        merged.set(key, { item, root: path.resolve(root), rootIndex })
        continue
      }

      if (scoreOf(item, path.resolve(root)) > scoreOf(prev.item, prev.root)) {
        merged.set(key, { item, root: path.resolve(root), rootIndex })
      }
    }
  })

  return [...merged.values()]
    .map((v) => v.item)
    .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)))
}

/**
 * 给候选条目打分，分数越高越优先保留。
 *
 * 场景：userData 里同时有 `AdShield/`（旧命名）和 `adshield_exe/`（当前命名），
 * 两者装的都是 AdShield.exe。必须让后者胜出。
 *
 * 判定依据：当前命名约定是「小写 + 下划线」的目录名（adshield_exe、
 * plugins_compound_search），而旧的是驼峰（AdShield、compound_search）。
 *
 * @param {object} item
 * @param {string} root 该条目所在的插件根目录
 */
function scoreOf(item, root) {
  const id = String(item.id || '')
  let score = 0

  // b) 小写 + 下划线 = 当前命名约定，权重最高
  if (/^[a-z0-9]+(_[a-z0-9]+)*$/.test(id)) score += 100

  // 驼峰命名（AdShield）代表历史残留，直接扣分
  if (/[A-Z]/.test(id)) score -= 50

  return score
}

module.exports = {
  isExePluginEntry,
  isStandaloneExeFile,
  identityOf,
  scanExePlugins,
  scanExePluginsIn,
  listExeFiles,
  computeSize,
  formatBytes,
  guessExeKind,
  PYINSTALLER_INTERNAL_DIR,
}
