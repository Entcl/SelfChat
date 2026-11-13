/**
 * server/routes/adshield.js
 * ============================================================
 * AdShield 激活码 —— 本地 exe 按需调用路由
 *
 * 架构：前端 → POST /api/local-python/search → Node → spawn(AdShield.exe, [keyword])
 *
 * 和上一版（HTTP 微服务）的区别：
 *   - 不再有常驻进程、不再占用 8000 端口、不需要用户手动开终端跑 main.py
 *   - exe 只在请求发生时启动一次，拿到 stdout 就退出，用完即焚
 *   - /health 改成检查文件是否存在，零开销
 *
 * 文件名保留 local-python.js 的挂载路径不变（/api/local-python），
 * 这样前端 API 层不用改 URL，只改一下状态文案即可。
 * ============================================================
 */

const express = require('express')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

// ============================================================
// 一、可配置项
// ============================================================

// exe 文件名。改这里就能切换成别的插件。
const EXE_NAME = process.env.SELFCHAT_ADSHIELD_NAME || 'AdShield.exe'

// exe 所在的插件目录名（onedir 布局下就是它）。
// 当前约定：<plugins 根>/adshield_exe/AdShield.exe + _internal/
// 改名只需要动这里，不需要翻代码里散落的路径。
const PLUGIN_DIR_NAME = process.env.SELFCHAT_ADSHIELD_DIRNAME || 'adshield_exe'

// 历史目录名：老安装里 exe 曾放在 plugins/AdShield/ 下。
// 保留只读兼容，避免用户升级后突然「插件未找到」。
const LEGACY_DIR_NAMES = ['AdShield']

// 单次调用超时（毫秒）。超时立刻强杀进程并报错。
const EXE_TIMEOUT_MS = Number(process.env.SELFCHAT_ADSHIELD_TIMEOUT_MS) || 10_000

// stdout 最大保留字节数，防止 exe 失控输出把内存打爆
const MAX_STDOUT_BYTES = 8 * 1024 * 1024

// keyword 长度上限
const MAX_KEYWORD_LEN = 200

/**
 * 解析插件目录。按优先级依次尝试，用第一个真实存在的 exe：
 *
 * 每个插件根目录下支持两种 PyInstaller 产物布局：
 *   a) onefile：<root>/AdShield.exe                                  —— 单文件，分发简单
 *   b) onedir ：<root>/adshield_exe/AdShield.exe + _internal/        —— 免解压，启动更快
 *
 * 插件根目录按优先级：
 *   1. SELFCHAT_ADSHIELD_DIR            —— 环境变量显式指定（调试用）
 *   2. <userData>/plugins               —— Electron 打包后的运行时目录
 *   3. <server>/plugins                 —— 开发期目录（index.js 会同步到 userData）
 *
 * 注意：server/index.js 启动时会把 server/plugins/* 递归复制到 userData/plugins/*，
 * 所以把 exe（或整个 adshield_exe 目录）放进 server/plugins 后，
 * 打包运行时它会自动出现在 userData 下。
 */
function pluginRoots() {
  const roots = []

  const explicitDir = (process.env.SELFCHAT_ADSHIELD_DIR || '').trim()
  if (explicitDir) roots.push(path.resolve(explicitDir))

  // 复刻 index.js 里 userDataDir 的推导逻辑
  let userDataDir = path.join(__dirname, '..')
  try {
    const { app } = require('electron')
    if (app && typeof app.getPath === 'function') {
      userDataDir = app.getPath('userData')
    }
  } catch {
    // 非 Electron 环境（比如直接用 node 起 server），忽略
  }
  roots.push(path.resolve(path.join(userDataDir, 'plugins')))

  // 开发期 / 内置插件目录
  roots.push(path.resolve(path.join(__dirname, '..', 'plugins')))

  return [...new Set(roots)]
}

/** exe 基名，不含扩展名（onefile 的备用名 / 日志用） */
const EXE_BASE = EXE_NAME.replace(/\.exe$/i, '')

/**
 * 列出所有候选 exe 路径，按优先级从高到低。
 *
 * 顺序上「目录版」优先于「单文件版」：
 * 目录版是当前打包方式（--onedir），单文件版属于历史产物，排后面免得抢跑。
 * 每个根目录下依次尝试：新目录名 → 历史目录名 → 根目录散放的单文件。
 */
function candidatePaths() {
  const list = []
  for (const root of pluginRoots()) {
    // onedir（当前约定）：<root>/adshield_exe/AdShield.exe
    list.push({ path: path.join(root, PLUGIN_DIR_NAME, EXE_NAME), layout: 'onedir' })
    // onedir（历史兼容）：<root>/AdShield/AdShield.exe
    for (const legacy of LEGACY_DIR_NAMES) {
      list.push({ path: path.join(root, legacy, EXE_NAME), layout: 'onedir-legacy' })
    }
    // onefile（历史兼容）：<root>/AdShield.exe
    list.push({ path: path.join(root, EXE_NAME), layout: 'onefile' })
  }
  // 去重（Windows 路径大小写不敏感）
  const seen = new Set()
  return list.filter((item) => {
    const key = item.path.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 找到实际可用的 exe。
 * @returns {{ found: boolean, exePath: string|null, layout: string|null, candidates: string[], size: number, mtimeMs: number }}
 */
function resolveExe() {
  const candidates = candidatePaths()
  for (const item of candidates) {
    try {
      const stat = fs.statSync(item.path)
      if (stat.isFile()) {
        return {
          found: true,
          exePath: item.path,
          layout: item.layout,
          candidates: candidates.map((c) => c.path),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        }
      }
    } catch {
      // 不存在或不可访问，继续试下一个
    }
  }
  return {
    found: false,
    exePath: null,
    layout: null,
    candidates: candidates.map((c) => c.path),
    size: 0,
    mtimeMs: 0,
  }
}

// ============================================================
// 二、子进程输出解码
// ============================================================
/**
 * 解码 exe 的输出。
 *
 * 为什么要这个函数：Windows 下 Python（以及 PyInstaller 打出来的 exe）在
 * stdout 被管道接管时，默认按系统区域编码输出。中文 Windows 就是 GBK/cp936。
 * 直接 buffer.toString('utf8') 会把中文变成乱码。
 *
 * 策略：先看 BOM → 再试严格 UTF-8 → 失败则按 GBK → 最后兜底替换字符。
 */
function decodeOutput(buf) {
  if (!buf || buf.length === 0) return ''

  // BOM 判断
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf)
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf)
  }
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3))
  }

  // 严格 UTF-8：能解通就是 UTF-8
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    // 不是合法 UTF-8，按 GBK 再试
    try {
      return new TextDecoder('gbk').decode(buf)
    } catch {
      return buf.toString('utf8')
    }
  }
}

/** 清掉尾部空行与 \r，保留内部换行 */
function tidy(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\s+$/, '')
}

// ============================================================
// 三、超时强杀
// ============================================================
/**
 * 强制结束子进程（含子进程树）。
 *
 * 为什么不能只 child.kill()：PyInstaller 打出来的 exe 是「bootloader + 真实进程」
 * 两层结构。onefile 模式下 bootloader 会再 fork 一个子进程执行你的代码，
 * 杀掉 bootloader 那个 PID 后，真正干活的子进程可能变成孤儿继续跑。
 * 所以 Windows 上优先用 taskkill /T（T = 连子进程树一起杀）。
 *
 * @returns {Promise<void>} taskkill 结束后 resolve（失败也会 resolve）
 */
function killTree(child, reason) {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null) return resolve()
    const pid = child.pid
    if (!pid) return resolve()

    console.warn(`[adshield] 强制结束进程 pid=${pid}（${reason}）`)

    if (process.platform === 'win32') {
      try {
        // spawn 而不是 exec，避免 taskkill 的输出再走一次解码
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
        killer.on('error', () => {
          // taskkill 不存在或权限不足，退回 Node 自带的 kill
          try {
            child.kill('SIGKILL')
          } catch {}
          resolve()
        })
        killer.on('close', () => resolve())
        // taskkill 卡住也不能无限等
        setTimeout(resolve, 3000).unref?.()
        return
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {}
        return resolve()
      }
    }

    try {
      child.kill('SIGKILL')
    } catch {}
    return resolve()
  })
}

// ============================================================
// 四、核心：调用 exe
// ============================================================
/**
 * 启动 exe 并收集输出。
 *
 * @param {string} exePath  exe 绝对路径
 * @param {string} keyword  唯一命令行参数
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number, elapsedMs: number, timedOut: boolean }>}
 */
function runExe(exePath, keyword) {
  return new Promise((resolve) => {
    const startedAt = Date.now()

    let settled = false
    let timedOut = false
    let timer = null

    const stdoutChunks = []
    let stdoutBytes = 0
    let stdoutTruncated = false
    const stderrChunks = []
    let stderrBytes = 0

    const finish = (payload) => {
      if (settled) return
      settled = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      resolve({ ...payload, elapsedMs: Date.now() - startedAt, timedOut })
    }

    let child
    try {
      child = spawn(exePath, [keyword], {
        // windowsHide: 不弹出黑色控制台窗口 —— 这是「告别手动开黑框」的关键
        windowsHide: true,
        // stdin 关掉：exe 如果等输入会立刻拿到 EOF 而不是卡住
        stdio: ['ignore', 'pipe', 'pipe'],
        // 工作目录设为 exe 所在目录，方便它找到同目录的附带文件
        cwd: path.dirname(exePath),
        env: {
          ...process.env,
          // 让 Python 系 exe 优先用 UTF-8 输出，和 decodeOutput 的 UTF-8 分支对齐
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
      })
    } catch (err) {
      return finish({
        stdout: '',
        stderr: '',
        exitCode: -1,
        spawnError: err,
      })
    }

    // ---- 超时定时器 ----
    // 关键：超时后不能只依赖 close 事件来 resolve。
    // 如果 taskkill 因为权限等原因没杀掉进程，close 永远不会来，
    // 用户的请求就会一直挂着（实测会拖到 exe 自己退出为止）。
    // 所以这里杀完等一小段宽限期，无论进程死没死都必须给上游一个答复。
    timer = setTimeout(async () => {
      timedOut = true

      // 先把此刻已经收到的输出留存下来，避免下面 finish 后丢掉
      const snapshotOut = decodeOutput(Buffer.concat(stdoutChunks))
      const snapshotErr = decodeOutput(Buffer.concat(stderrChunks))

      await killTree(child, `超过 ${EXE_TIMEOUT_MS}ms 未退出`)

      // 杀掉进程后，等 close 事件把剩余输出冲干净；最多再等 1500ms
      setTimeout(() => {
        finish({
          stdout: decodeOutput(Buffer.concat(stdoutChunks)) || snapshotOut,
          stderr: decodeOutput(Buffer.concat(stderrChunks)) || snapshotErr,
          exitCode: -1,
          signal: 'TIMEOUT',
          forceSettled: true,
        })
      }, 1500)
    }, EXE_TIMEOUT_MS)

    // ---- 收集 stdout ----
    child.stdout?.on('data', (chunk) => {
      if (stdoutTruncated) return
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        stdoutTruncated = true
        stdoutChunks.push(chunk.subarray(0, Math.max(0, chunk.length - (stdoutBytes - MAX_STDOUT_BYTES))))
        // 这里不需要等：超限只是截断内容，进程会继续跑完再 close
        killTree(child, 'stdout 超出大小上限')
        return
      }
      stdoutChunks.push(chunk)
    })

    // ---- 收集 stderr ----
    child.stderr?.on('data', (chunk) => {
      // stderr 只留最后 64KB，够定位问题就行
      stderrChunks.push(chunk)
      stderrBytes += chunk.length
      if (stderrBytes > 64 * 1024) {
        const joined = Buffer.concat(stderrChunks)
        stderrChunks.length = 0
        stderrChunks.push(joined.subarray(joined.length - 64 * 1024))
        stderrBytes = stderrChunks[0].length
      }
    })

    // ---- 进程事件 ----
    child.on('error', (err) => {
      // 常见：ENOENT（文件被删了）、EACCES（没有执行权限）、UNKNOWN（被杀软拦截）
      finish({ stdout: '', stderr: '', exitCode: -1, spawnError: err })
    })

    child.on('close', (code, signal) => {
      const stdout = decodeOutput(Buffer.concat(stdoutChunks))
      const stderr = decodeOutput(Buffer.concat(stderrChunks))
      finish({
        stdout,
        stderr,
        exitCode: typeof code === 'number' ? code : -1,
        signal: signal || null,
        stdoutTruncated,
      })
    })
  })
}

// ============================================================
// 五、错误翻译
// ============================================================
/** 把 spawn 的 error.code 翻译成中文 */
function describeSpawnError(err) {
  const code = err?.code || ''
  const map = {
    ENOENT: '插件文件不存在（可能被杀毒软件隔离），请重新安装',
    EACCES: '插件没有执行权限，请检查文件属性或杀毒软件拦截',
    EPERM: '系统拒绝执行插件，可能被杀毒软件或安全策略拦截',
    UNKNOWN: '无法启动插件，常见原因是杀毒软件拦截',
    EMFILE: '系统打开的文件过多，请重启应用',
    ENOMEM: '内存不足，无法启动插件',
  }
  return map[code] || `无法启动插件：${err?.message || '未知错误'}`
}

/** stderr 里可能带 Python traceback，取最后一非空行作为摘要 */
function summarizeStderr(stderr) {
  const text = tidy(stderr)
  if (!text) return ''
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return ''
  // 优先找 "xxxError: yyy" 这种异常行
  const excLine = [...lines].reverse().find((l) => /^[A-Za-z_][\w.]*(Error|Exception|Warning):/.test(l))
  return (excLine || lines[lines.length - 1]).slice(0, 500)
}

// ============================================================
// 六、参数校验
// ============================================================
/**
 * 校验并规范化 keyword。
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function validateKeyword(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: '参数 keyword 不能为空' }
  }

  const value = raw.trim()

  if (value.length > MAX_KEYWORD_LEN) {
    return { ok: false, error: `keyword 长度不能超过 ${MAX_KEYWORD_LEN} 个字符` }
  }

  // 拒绝 NUL 和其余控制字符：spawn 参数里夹 NUL 会被系统截断，可能改变参数含义
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return { ok: false, error: 'keyword 不能包含换行或控制字符' }
  }

  // 拒绝以 - 开头：虽然用了 spawn 不走 shell，但 exe 自己的 argv 解析
  // 会把 -x / --foo 当成选项，可能绕过预期行为
  if (value.startsWith('-')) {
    return { ok: false, error: 'keyword 不能以连字符 - 开头' }
  }

  return { ok: true, value }
}

// ============================================================
// 七、路由
// ============================================================
function createLocalPythonRouter() {
  const router = express.Router()

  /**
   * POST /search
   * 请求：{ keyword: "ABCD1234" }
   * 响应：{ ok, keyword, result, elapsed_ms, truncated }
   */
  router.post('/search', async (req, res) => {
    const check = validateKeyword(req.body?.keyword)
    if (!check.ok) {
      return res.status(400).json({ error: check.error })
    }
    const keyword = check.value

    // 1) 先确认 exe 在不在
    const resolved = resolveExe()
    if (!resolved.found) {
      console.error('[adshield] 未找到插件，尝试过的路径:', resolved.candidates)
      return res.status(500).json({
        error: '插件未找到，请重新安装',
        code: 'PLUGIN_NOT_FOUND',
        detail: `已尝试：${resolved.candidates.join(' | ')}`,
      })
    }

    // 2) 空文件基本等于安装损坏
    if (resolved.size === 0) {
      console.error(`[adshield] 插件文件为空: ${resolved.exePath}`)
      return res.status(500).json({
        error: '插件文件已损坏（大小为 0），请重新安装',
        code: 'PLUGIN_EMPTY',
        detail: resolved.exePath,
      })
    }

    // 3) 执行
    console.log(`[adshield] 调用插件 keyword=%j`, keyword)
    const result = await runExe(resolved.exePath, keyword)

    // ---- 3.1 超时 ----
    if (result.timedOut) {
      console.error(`[adshield] 插件超时（${result.elapsedMs}ms）keyword=%j`, keyword)
      return res.status(504).json({
        error: `插件执行超时（超过 ${Math.round(EXE_TIMEOUT_MS / 1000)} 秒），已强制结束`,
        code: 'PLUGIN_TIMEOUT',
        elapsed_ms: result.elapsedMs,
      })
    }

    // ---- 3.2 根本没起来 ----
    if (result.spawnError) {
      const message = describeSpawnError(result.spawnError)
      console.error('[adshield] 插件启动失败:', result.spawnError)
      return res.status(500).json({
        error: message,
        code: 'PLUGIN_SPAWN_FAILED',
        detail: result.spawnError.code || result.spawnError.message,
      })
    }

    // ---- 3.3 输出过大 ----
    if (result.stdoutTruncated) {
      return res.status(502).json({
        error: '插件输出过大，已中止。请检查插件逻辑',
        code: 'PLUGIN_OUTPUT_TOO_LARGE',
      })
    }

    // ---- 3.4 非零退出码：优先展示 stderr ----
    if (result.exitCode !== 0) {
      const reason = summarizeStderr(result.stderr) || `退出码 ${result.exitCode}`
      console.error(
        `[adshield] 插件执行失败 exitCode=${result.exitCode} keyword=%j stderr=%j`,
        keyword,
        tidy(result.stderr).slice(0, 800),
      )
      return res.status(500).json({
        error: `插件执行失败：${reason}`,
        code: 'PLUGIN_EXIT_NONZERO',
        exit_code: result.exitCode,
        detail: tidy(result.stderr).slice(0, 2000) || undefined,
      })
    }

    // ---- 3.5 成功：stdout 就是结果 ----
    const output = tidy(result.stdout)
    if (!output) {
      // 退出码 0 但没输出，通常是脚本忘了 print
      console.error(`[adshield] 插件没有输出 keyword=%j`, keyword)
      return res.status(502).json({
        error: '插件没有返回任何内容，请检查插件是否调用了 print()',
        code: 'PLUGIN_EMPTY_OUTPUT',
        detail: tidied(result) || undefined,
      })
    }

    console.log(`[adshield] 成功 ${result.elapsedMs}ms keyword=%j`, keyword)
    return res.json({
      ok: true,
      keyword,
      result: output,
      elapsed_ms: result.elapsedMs,
      truncated: false,
    })
  })

  /**
   * GET /health
   * 纯文件检查，不启动任何进程，调用成本接近零。
   */
  router.get('/health', (_req, res) => {
    const resolved = resolveExe()

    // 文件在但大小为 0：安装损坏，算「半可用」
    if (resolved.found && resolved.size === 0) {
      return res.status(200).json({
        reachable: false,
        code: 'PLUGIN_EMPTY',
        error: '插件文件已损坏（大小为 0），请重新安装',
        plugin: {
          found: true,
          empty: true,
          name: EXE_NAME,
          path: resolved.exePath,
          size: 0,
          mtime_ms: resolved.mtimeMs,
        },
      })
    }

    if (!resolved.found) {
      return res.status(200).json({
        reachable: false,
        code: 'PLUGIN_NOT_FOUND',
        error: '插件未找到，请重新安装',
        plugin: {
          found: false,
          empty: false,
          name: EXE_NAME,
          path: null,
          expected: resolved.candidates,
          size: 0,
          mtime_ms: 0,
        },
      })
    }

    return res.status(200).json({
      reachable: true,
      code: 'PLUGIN_READY',
      error: null,
      plugin: {
        found: true,
        empty: false,
        name: EXE_NAME,
        path: resolved.exePath,
        layout: resolved.layout,
        size: resolved.size,
        mtime_ms: resolved.mtimeMs,
        size_human: formatBytes(resolved.size),
      },
    })
  })

  return router
}

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

function tidied(result) {
  const t = tidy(result?.stdout)
  return t ? t.slice(0, 500) : undefined
}

module.exports = {
  createLocalPythonRouter,
  // 导出这些方便单测 / 排查
  resolveExe,
  EXE_NAME,
  EXE_TIMEOUT_MS,
}

/* ============================================================
 * 挂载方式（server/index.js，位置不变）
 * ------------------------------------------------------------
 *   const { createLocalPythonRouter } = require('./routes/local-python')
 *   app.use('/api/local-python', createLocalPythonRouter())
 *
 * URL 保持 /api/local-python/*，前端不用改接口地址。
 * ============================================================ */
