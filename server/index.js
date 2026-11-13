const express = require('express')
const cors = require('cors')
const multer = require('multer')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const Module = require('module')

// ============================================================
// 网络代理（对应设置面板「网络代理」字段）
// https 目标经 HttpsProxyAgent 走用户配置的代理（国内访问海外 API 场景）；
// http:// 本地服务（如 Ollama）始终直连，不走代理。
// 依赖缺失时安全降级为直连并打印告警，不影响原有链路。
// ============================================================
let HttpsProxyAgent = null
try {
  HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent
} catch (e) {}

function buildProxyAgent(proxyUrl, targetUrl) {
  const raw = String(proxyUrl || '').trim()
  if (!raw || !/^https?:\/\//i.test(raw)) return null
  if (!HttpsProxyAgent) {
    console.warn('[Proxy] 已配置代理但缺少 https-proxy-agent 依赖，本次请求降级为直连')
    return null
  }
  try {
    if (new URL(targetUrl).protocol !== 'https:') return null
    return new HttpsProxyAgent(raw)
  } catch {
    return null
  }
}

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return originalResolveFilename(request, parent, isMain, options)
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && parent && parent.filename.includes('AppData')) {
      return originalResolveFilename(request, module, isMain, options)
    }
    throw err
  }
}

let userDataDir = __dirname
try {
  const { app } = require('electron')
  if (app) userDataDir = app.getPath('userData')
} catch (e) {}

const dbPath = process.env.DB_PATH || path.join(userDataDir, 'data.sqlite')
process.env.DB_PATH = dbPath
const { getKV, setKV } = require('./db')
// 本地 Python 微服务转发路由（POST /api/local-python/search）
const { createLocalPythonRouter } = require('./routes/local-python')
// EXE 插件扫描：与 JS 插件分流，避免两类产物混在同一个列表里
const { isExePluginEntry, isStandaloneExeFile, scanExePlugins } = require('./routes/exe-plugins')

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' })) 
app.use(express.static(path.join(__dirname, '../dist')))

// 必须在 express.json() 之后挂载，否则 req.body 是 undefined
app.use('/api/local-python', createLocalPythonRouter())

const PLUGINS_DIR = path.join(userDataDir, 'plugins')
if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true })

const builtinPluginsDir = path.join(__dirname, 'plugins')
if (fs.existsSync(builtinPluginsDir)) {
  const files = fs.readdirSync(builtinPluginsDir)
  files.forEach(file => {
    if (file.startsWith('.')) return
    const srcPath = path.join(builtinPluginsDir, file)
    const destPath = path.join(PLUGINS_DIR, file)
    if (!fs.existsSync(destPath)) {
      fs.cpSync(srcPath, destPath, { recursive: true })
    }
  })
}

const CONFIG_FILE = path.join(userDataDir, 'plugins_config.json')
let pluginConfig = {}
if (fs.existsSync(CONFIG_FILE)) {
  try { pluginConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) } catch (e) {}
}

let installedPlugins = []
let pluginErrors = []

/**
 * 计算「插件身份」用于去重。
 *
 * 历史包袱：同一插件在 userData 里会留下多份（改名前 / 改名后的目录）。
 * index.js 启动时只做「目标不存在才复制」，从不删旧文件，
 * 所以旧目录会一直堆着，扫描时看起来就像装了多份。
 *
 * 身份优先级（任一命中即视为同一插件）：
 *   1. 插件自己声明的 info.name —— 最可靠，跨目录名变化
 *   2. 目录名归一化后相同 —— 剥离 plugins_ / plugin_ 前缀、去掉非字母数字，
 *      于是 compound_search 和 plugins_compound_search 会归到同一个 key
 */
function normalizePluginId(rawId) {
  return String(rawId || '')
    .toLowerCase()
    .replace(/\.js$/, '')
    // 剥离常见的目录名前缀：plugins_compound_search → compound_search
    .replace(/^plugins?[_-]/, '')
    // 去掉分隔符，让 compound_search / compoundsearch / compound-search 等价
    .replace(/[^a-z0-9]/g, '')
}

/**
 * 返回插件的全部身份候选。
 * 只要两个插件的候选集合有交集，就认为它们是同一个插件。
 */
function jsPluginIdentityKeys(item) {
  const keys = new Set()

  const declared = String(item.declaredName || '').trim()
  if (declared) keys.add(`name:${declared.toLowerCase()}`)

  const norm = normalizePluginId(item.id)
  if (norm) keys.add(`id:${norm}`)

  return keys
}

/**
 * 对一组插件按身份去重。
 *
 * @param {Array<object>} list
 * @param {Set<string>} preferredIds 内置目录（server/plugins）里存在的名字集合。
 *        同一个插件有多份时，优先保留「随应用一起发布的那份」，
 *        这样 userData 里的历史残留不会盖住当前正确版本。
 */
function dedupePlugins(list, preferredIds) {
  /** @type {Array<{item: object, keys: Set<string>}>} 已保留的条目 */
  const kept = []

  // 先按「是否内置」排序：内置的优先参与匹配，从而占位胜出
  const ordered = [...list].sort((a, b) => {
    const pa = preferredIds.has(a.id) ? 0 : 1
    const pb = preferredIds.has(b.id) ? 0 : 1
    if (pa !== pb) return pa - pb
    // 同级别时，名字短的优先（compound_search 比 plugins_compound_search 更「原本」）
    return String(a.id).length - String(b.id).length
  })

  for (const item of ordered) {
    const keys = jsPluginIdentityKeys(item)
    if (keys.size === 0) continue

    // 与已保留条目有任意一个身份重叠 → 视为重复，丢弃
    const dup = kept.some((k) => [...keys].some((key) => k.keys.has(key)))
    if (dup) continue

    kept.push({ item, keys })
  }

  return kept.map((k) => k.item)
}

/** 内置插件目录里有哪些顶层名字（用于判定「哪份是随应用发布的」） */
function listBuiltinPluginNames() {
  const names = new Set()
  try {
    for (const f of fs.readdirSync(builtinPluginsDir)) {
      if (f.startsWith('.')) continue
      names.add(f)
    }
  } catch {
    // 目录不存在（打包后可能被裁掉），返回空集合即可
  }
  return names
}

function scanPlugins() {
  pluginErrors = [] 
  const files = fs.readdirSync(PLUGINS_DIR)
  const list = []

  for (const file of files) {
    if (file.startsWith('.')) continue 

    // 👈 EXE 插件与 JS 插件形态完全不同，先在入口处分流，
    // 避免 adshield_exe 这类目录混进「普通插件」列表。
    const verdict = isExePluginEntry(PLUGINS_DIR, file)
    if (verdict.isExe) continue

    // 孤立的 .exe 文件（单文件版残留）既不是 JS 插件也不是 EXE 插件，直接跳过
    if (isStandaloneExeFile(PLUGINS_DIR, file)) continue

    const fullPath = path.join(PLUGINS_DIR, file)
    const stat = fs.statSync(fullPath)

    // 👈 核心兼容：如果是旧版的布尔值，转换成对象
    const savedConfig = pluginConfig[file]
    let currentConfig = { enabled: false, alias: '' }
    if (typeof savedConfig === 'boolean') {
      currentConfig.enabled = savedConfig
    } else if (typeof savedConfig === 'object' && savedConfig !== null) {
      currentConfig = { ...currentConfig, ...savedConfig }
    }

    if (stat.isDirectory()) {
      const entryFiles = ['main.js', 'index.js', `${file}.js`]
      let entryPath = null
      for (const entry of entryFiles) {
        const p = path.join(fullPath, entry)
        if (fs.existsSync(p)) { entryPath = p; break }
      }
      if (!entryPath) continue

      try {
        delete require.cache[require.resolve(entryPath)]
        const plugin = require(entryPath)
        const info = plugin.info || {}
        let readmeText = info.readme || '# 暂无文档'
        const readmePath = path.join(fullPath, 'README.md')
        if (fs.existsSync(readmePath)) {
          try { readmeText = fs.readFileSync(readmePath, 'utf-8') } catch (e) {}
        }

        list.push({
          id: file, 
          name: file, // 物理名
          declaredName: info.name || '', // 👈 插件自己声明的名字，用于跨目录名去重
          alias: currentConfig.alias, // 👈 别名
          version: info.version || '1.0.0',
          desc: info.desc || '文件夹插件', readme: readmeText,
          enabled: currentConfig.enabled, path: entryPath
        })
      } catch (err) {
        console.error(`[插件加载失败] ${file}:`, err.message)
        pluginErrors.push(`${file}: ${err.message}`) 
      }
    } else if (file.endsWith('.js')) {
      try {
        delete require.cache[require.resolve(fullPath)]
        const plugin = require(fullPath)
        const info = plugin.info || {}
        let readmeText = info.readme || '# 暂无文档'
        const sameNameMd = path.join(PLUGINS_DIR, file.replace('.js', '.md'))
        if (fs.existsSync(sameNameMd)) {
          try { readmeText = fs.readFileSync(sameNameMd, 'utf-8') } catch (e) {}
        }

        list.push({
          id: file, name: file.replace('.js', ''),
          declaredName: info.name || '',
          alias: currentConfig.alias, 
          version: info.version || '1.0.0',
          desc: info.desc || '单文件插件', readme: readmeText,
          enabled: currentConfig.enabled, path: fullPath
        })
      } catch (err) {
        console.error(`[插件加载失败] ${file}:`, err.message)
        pluginErrors.push(`${file}: ${err.message}`) 
      }
    }
  }

  // 👈 强制去重：同一插件在 userData 里可能有多份历史残留，
  // 只保留「随应用发布的那份」，其余丢弃。
  const deduped = dedupePlugins(list, listBuiltinPluginNames())

  installedPlugins = deduped
    .map(({ declaredName, ...rest }) => rest) // declaredName 只用于去重，不外泄
    .sort((a, b) => (a.alias || a.name).localeCompare(b.alias || b.name))
  return installedPlugins
}

scanPlugins()

const storage = multer.memoryStorage()
const upload = multer({ storage })

app.get('/api/storage/:key', (req, res) => {
  res.json({ value: getKV(req.params.key) })
})

app.post('/api/storage/:key', (req, res) => {
  const { key } = req.params
  const { value } = req.body
  try {
    setKV(key, value)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: `写入失败: ${err.message}` })
  }
})

app.get('/api/plugins', (req, res) => {
  const list = scanPlugins()
  res.json({ plugins: list, errors: pluginErrors })
})

/**
 * EXE 插件清单。
 * 独立数据源：只返回「含 .exe 或 _internal 的目录 / .exe 文件」，与 JS 插件完全隔离。
 * 扫描顺序与 local-python 路由的 resolveExe 一致：userData 优先，内置目录兜底。
 */
app.get('/api/plugins/exe', (req, res) => {
  try {
    const list = scanExePlugins([PLUGINS_DIR, builtinPluginsDir], pluginConfig)
    res.json({ plugins: list, errors: [] })
  } catch (err) {
    console.error('[EXE 插件扫描失败]', err)
    res.status(500).json({ error: `EXE 插件扫描失败: ${err.message}`, plugins: [] })
  }
})

/**
 * 启用/禁用单个 EXE 插件。
 * 写入 plugins_config.json；AdShield 面板会据此决定是否允许打开控制台。
 */
app.post('/api/plugins/exe/:id/toggle', (req, res) => {
  const id = String(req.params.id || '')
  const { enabled } = req.body || {}

  // 只允许操作真实存在的 EXE 插件，防止用 id 穿越到其它目录
  const all = scanExePlugins([PLUGINS_DIR, builtinPluginsDir], pluginConfig)
  const target = all.find((p) => p.id.toLowerCase() === id.toLowerCase())
  if (!target) {
    return res.status(404).json({ error: 'EXE 插件不存在' })
  }

  const prev = pluginConfig[id]
  const next =
    typeof prev === 'object' && prev !== null
      ? { ...prev, enabled: Boolean(enabled) }
      : { enabled: Boolean(enabled), alias: '' }

  pluginConfig[id] = next
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(pluginConfig, null, 2), 'utf-8')
  } catch (err) {
    return res.status(500).json({ error: `配置写入失败: ${err.message}` })
  }

  res.json({ success: true, id, enabled: Boolean(enabled) })
})

/**
 * 校验上传的相对路径：拒绝绝对路径、盘符、`..` 穿越与空字节。
 * 返回规范化后的相对路径，非法时返回 null。
 */
function sanitizeUploadPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return null
  if (rawPath.includes('\0')) return null

  // 统一分隔符并去掉开头的 ./ 或 /
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\.?\//, '')
  if (!normalized) return null

  // 拒绝 Windows 盘符与 UNC 路径
  if (/^[a-zA-Z]:/.test(normalized) || normalized.startsWith('//')) return null

  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return null
  // 任何一段是 .. 都视为穿越
  if (parts.some((seg) => seg === '..')) return null

  return parts
}

app.post('/api/plugins/upload-multi', upload.any(), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: '未接收到文件' })
    
    let paths = []
    if (req.body.pathsJson) {
      try { paths = JSON.parse(req.body.pathsJson) } catch (e) {}
    }
    if (!Array.isArray(paths)) paths = []

    if (req.files.length === 1 && paths.length <= 1) {
      const file = req.files[0]
      if (!file.originalname.endsWith('.js')) return res.status(400).json({ error: '必须是 .js 文件' })
      // 单文件上传也只用 basename，避免 originalname 里夹带路径
      const safeName = path.basename(file.originalname.replace(/\\/g, '/'))
      if (!safeName || safeName === '.' || safeName === '..') {
        return res.status(400).json({ error: '非法的文件名' })
      }
      fs.writeFileSync(path.join(PLUGINS_DIR, safeName), file.buffer)
      scanPlugins()
      return res.json({ success: true })
    }

    if (paths.length === 0) return res.status(400).json({ error: '路径解析失败' })

    // 先整体校验所有路径，任一条非法就整体拒绝，避免写入部分文件
    const sanitized = []
    for (const p of paths) {
      const segs = sanitizeUploadPath(p)
      if (!segs) return res.status(400).json({ error: `非法的上传路径: ${String(p).slice(0, 120)}` })
      sanitized.push(segs)
    }

    const folderName = sanitized[0][0]
    if (!folderName || folderName === '.' || folderName === '..') {
      return res.status(400).json({ error: '非法的插件目录名' })
    }
    const targetFolder = path.join(PLUGINS_DIR, folderName)
    // 双保险：目标目录必须位于 PLUGINS_DIR 之内
    if (!path.resolve(targetFolder).startsWith(path.resolve(PLUGINS_DIR) + path.sep)) {
      return res.status(400).json({ error: '非法的插件目录名' })
    }

    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true })
    }

    req.files.forEach((file, index) => {
      const segs = sanitized[index] || sanitized[0]
      const innerPath = segs.slice(1).join(path.sep)

      if (innerPath) {
        const dest = path.join(targetFolder, innerPath)
        // 最终落盘路径仍需在 targetFolder 内
        if (!path.resolve(dest).startsWith(path.resolve(targetFolder) + path.sep)) return
        const destDir = path.dirname(dest)
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
        fs.writeFileSync(dest, file.buffer)
      }
    })

    scanPlugins()
    res.json({ success: true })
  } catch (err) {
    console.error('❌ 上传插件失败:', err)
    res.status(500).json({ error: `保存失败: ${err.message}` })
  }
})

app.post('/api/plugins/:id/toggle', (req, res) => {
  const file = req.params.id
  let savedConfig = pluginConfig[file]
  let currentConfig = typeof savedConfig === 'object' && savedConfig !== null ? savedConfig : { enabled: !!savedConfig, alias: '' }
  
  currentConfig.enabled = req.body.enabled
  pluginConfig[file] = currentConfig
  
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(pluginConfig, null, 2))
  res.json({ success: true })
})

// 👈 新增：重命名插件接口
app.post('/api/plugins/:id/rename', (req, res) => {
  const file = req.params.id
  const { alias } = req.body
  let savedConfig = pluginConfig[file]
  let currentConfig = typeof savedConfig === 'object' && savedConfig !== null ? savedConfig : { enabled: !!savedConfig, alias: '' }
  
  currentConfig.alias = alias
  pluginConfig[file] = currentConfig
  
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(pluginConfig, null, 2))
  res.json({ success: true })
})

app.delete('/api/plugins/:id', (req, res) => {
  const id = req.params.id
  // 不依赖内存里的 installedPlugins：冷启动后未调用过 /api/plugins 时它仍是空数组。
  // 这里重新扫描一次，保证删除操作总能定位到真实的磁盘路径。
  const list = scanPlugins()
  const target = list.find((x) => x.id === id)

  if (!target) return res.status(404).json({ error: '未找到该插件' })

  try {
    if (id.endsWith('.js')) {
      if (fs.existsSync(target.path)) fs.unlinkSync(target.path)
      const mdPath = target.path.replace(/\.js$/, '.md')
      if (fs.existsSync(mdPath)) fs.unlinkSync(mdPath)
    } else {
      // 文件夹插件：target.path 是入口文件，删除其所在目录
      const folderPath = path.dirname(target.path)
      // 安全兜底：只允许删除 PLUGINS_DIR 下的子目录
      if (path.resolve(folderPath) === path.resolve(PLUGINS_DIR) || !path.resolve(folderPath).startsWith(path.resolve(PLUGINS_DIR) + path.sep)) {
        return res.status(400).json({ error: '非法的插件路径' })
      }
      fs.rmSync(folderPath, { recursive: true, force: true })
    }

    delete pluginConfig[id]
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(pluginConfig, null, 2))
    scanPlugins()
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: `删除文件失败: ${err.message}` })
  }
})

app.get(['/api/tags', '/api/api/tags', '/api/v1/models'], async (req, res) => {
  try {
    const response = await axios.get('http://127.0.0.1:11434/api/tags')
    res.json(response.data)
  } catch (error) {
    res.json({ data: [], models: [] })
  }
})

app.post('/api/plugin-chat', async (req, res) => {
  let { messages, targetUrl, targetHeaders, proxyUrl, ...restPayload } = req.body
  let directReply = null

  for (const p of installedPlugins) {
    if (!p.enabled) continue
    try {
      delete require.cache[require.resolve(p.path)]
      const plugin = require(p.path)
      
      if (plugin.beforeChat) {
        const result = await plugin.beforeChat(messages)
        if (result && result.isDirectReply) {
          directReply = result.content
          break
        } else if (result) {
          messages = result
        }
      }
      
      if (plugin.overrideTarget) {
        const override = await plugin.overrideTarget(messages, { targetUrl, targetHeaders })
        if (override) {
          if (override.targetUrl) targetUrl = override.targetUrl
          if (override.targetHeaders) targetHeaders = { ...targetHeaders, ...override.targetHeaders }
          if (override.payload) restPayload = { ...restPayload, ...override.payload }
        }
      }
    } catch (err) {}
  }

  if (directReply) {
    const isOpenAI = targetUrl && targetUrl.includes('/v1/chat/completions')
    // 非流式（设置里关闭了流式输出）：直接回完整 JSON，渲染端按 message.content 解析
    if (restPayload.stream === false) {
      if (isOpenAI) {
        res.json({ choices: [{ message: { role: 'assistant', content: directReply } }], usage: { completion_tokens: 1 } })
      } else {
        res.json({ message: { role: 'assistant', content: directReply }, done: true, eval_count: 1, eval_duration: 100000000 })
      }
      return
    }
    res.setHeader('Content-Type', 'text/event-stream')
    if (isOpenAI) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: directReply } }] })}\n\n`)
      res.write(`data: [DONE]\n\n`)
    } else {
      res.write(`${JSON.stringify({ message: { role: 'assistant', content: directReply }, done: false })}\n`)
      res.write(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, eval_count: 1, eval_duration: 100000000 })}\n`)
    }
    res.end()
    return 
  }

  let finalTargetUrl = targetUrl
  if (targetUrl.startsWith('/api')) {
    finalTargetUrl = targetUrl.replace(/^\/api/, 'http://127.0.0.1:11434')
  }

  try {
    // 👇 配置了代理且目标是 https 时，经 HttpsProxyAgent 转发（http 目标由 buildProxyAgent 返回 null，保持直连）
    const proxyAgent = buildProxyAgent(proxyUrl, finalTargetUrl)
    const response = await axios({
      method: 'post', url: finalTargetUrl, headers: targetHeaders,
      data: { ...restPayload, messages }, responseType: 'stream',
      validateStatus: () => true,
      ...(proxyAgent ? { httpsAgent: proxyAgent } : {}),
    })
    if (response.status >= 400) {
      let errorMsg = `目标接口报错 HTTP ${response.status}`
      let errorData = ''
      response.data.on('data', chunk => { errorData += chunk.toString() })
      response.data.on('end', () => {
        try { errorMsg = JSON.parse(errorData).error?.message || errorMsg } catch {}
        res.status(response.status).json({ error: errorMsg })
      })
      return
    }
    res.setHeader('Content-Type', 'text/event-stream')
    response.data.pipe(res)
  } catch (error) {
    res.status(500).json({ error: `连接失败: ${error.message}` })
  }
})

// ============================================================
// 通用模型列表代理
// 手机/远程设备访问时，前端无法直连 127.0.0.1 的 Ollama 或内网模型服务，
// 因此由后端代为请求。targetUrl 必须显式给出，且做基础 SSRF 防护。
// ============================================================
app.post('/api/models', async (req, res) => {
  const { targetUrl, targetHeaders, proxyUrl } = req.body || {}

  if (typeof targetUrl !== 'string' || !targetUrl.trim()) {
    return res.status(400).json({ error: '缺少 targetUrl' })
  }

  let parsed
  try {
    parsed = new URL(targetUrl)
  } catch {
    return res.status(400).json({ error: 'targetUrl 不是合法 URL' })
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: '仅支持 http/https' })
  }

  // 只允许本机或内网地址直连代理（公网模型服务前端可直连，无需代理）；
  // 配置了代理时额外放行 https 公网地址 —— 由代理转发，用于访问海外 API
  const host = parsed.hostname
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
  const isPrivate =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  const hasProxy = typeof proxyUrl === 'string' && /^https?:\/\//i.test(proxyUrl.trim())
  if (!isLoopback && !isPrivate && !(hasProxy && parsed.protocol === 'https:')) {
    return res.status(400).json({ error: '代理仅限本机或内网地址（公网 https 地址需先配置网络代理）' })
  }

  try {
    const proxyAgent = hasProxy ? buildProxyAgent(proxyUrl, targetUrl) : null
    const response = await axios.get(targetUrl, {
      headers: targetHeaders || {},
      timeout: 15000,
      validateStatus: () => true,
      ...(proxyAgent ? { httpsAgent: proxyAgent } : {}),
    })
    if (response.status >= 400) {
      return res.status(response.status).json({ error: `模型服务返回 HTTP ${response.status}` })
    }
    res.json(response.data)
  } catch (error) {
    res.status(502).json({ error: `连接失败: ${error.message}` })
  }
})

const PORT = 3000
app.listen(PORT, () => console.log(`✅ 后端已启动，端口: ${PORT}，数据目录: ${userDataDir}`))