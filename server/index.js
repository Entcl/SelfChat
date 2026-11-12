const express = require('express')
const cors = require('cors')
const multer = require('multer')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const Module = require('module')

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

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' })) 
app.use(express.static(path.join(__dirname, '../dist')))

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

function scanPlugins() {
  pluginErrors = [] 
  const files = fs.readdirSync(PLUGINS_DIR)
  const list = []

  for (const file of files) {
    if (file.startsWith('.')) continue 
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
          id: file, name: file.replace('.js', ''), alias: currentConfig.alias, 
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
  installedPlugins = list.sort((a, b) => (a.alias || a.name).localeCompare(b.alias || b.name))
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
  let { messages, targetUrl, targetHeaders, ...restPayload } = req.body
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
    res.setHeader('Content-Type', 'text/event-stream')
    let isOpenAI = targetUrl && targetUrl.includes('/v1/chat/completions')
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
    const response = await axios({
      method: 'post', url: finalTargetUrl, headers: targetHeaders,
      data: { ...restPayload, messages }, responseType: 'stream',
      validateStatus: () => true 
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

const PORT = 3000
app.listen(PORT, () => console.log(`✅ 后端已启动，端口: ${PORT}，数据目录: ${userDataDir}`))