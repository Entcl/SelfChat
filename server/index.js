const express = require('express')
const cors = require('cors')
const multer = require('multer')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const db = require('./db')

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' })) 

// ================= 插件系统初始化 =================
const PLUGINS_DIR = path.join(__dirname, 'plugins')
if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR)

const CONFIG_FILE = path.join(__dirname, 'plugins_config.json')
let pluginConfig = {}
if (fs.existsSync(CONFIG_FILE)) {
  try { pluginConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) } catch (e) {}
}

let installedPlugins = []

function scanPlugins() {
  const files = fs.readdirSync(PLUGINS_DIR)
  const list = []

  for (const file of files) {
    if (file.startsWith('.')) continue 

    const fullPath = path.join(PLUGINS_DIR, file)
    const stat = fs.statSync(fullPath)

    if (stat.isDirectory()) {
      const entryFiles = ['main.js', 'index.js', `${file}.js`]
      let entryPath = null
      
      for (const entry of entryFiles) {
        const p = path.join(fullPath, entry)
        if (fs.existsSync(p)) {
          entryPath = p
          break
        }
      }
      
      if (!entryPath) continue

      try {
        delete require.cache[require.resolve(entryPath)]
        const plugin = require(entryPath)
        const info = plugin.info || {}
        
        // 👈 核心修改：优先读取文件夹下的 README.md
        let readmeText = info.readme || '# 暂无文档'
        const readmePath = path.join(fullPath, 'README.md')
        if (fs.existsSync(readmePath)) {
          try {
            readmeText = fs.readFileSync(readmePath, 'utf-8')
          } catch (e) {
            console.error(`[插件] 读取 README.md 失败: ${file}`)
          }
        }

        list.push({
          id: file,
          name: file, 
          version: info.version || '1.0.0',
          desc: info.desc || '文件夹插件',
          readme: readmeText,
          enabled: pluginConfig[file] || false,
          path: entryPath
        })
      } catch (err) {
        console.error(`[插件解析失败] ${file}:`, err.message)
      }

    } else if (file.endsWith('.js')) {
      try {
        delete require.cache[require.resolve(fullPath)]
        const plugin = require(fullPath)
        const info = plugin.info || {}
        
        // 单文件模式，尝试读取同名的 .md 文件
        let readmeText = info.readme || '# 暂无文档'
        const sameNameMd = path.join(PLUGINS_DIR, file.replace('.js', '.md'))
        if (fs.existsSync(sameNameMd)) {
          try { readmeText = fs.readFileSync(sameNameMd, 'utf-8') } catch (e) {}
        }

        list.push({
          id: file,
          name: file.replace('.js', ''), 
          version: info.version || '1.0.0',
          desc: info.desc || '单文件插件',
          readme: readmeText,
          enabled: pluginConfig[file] || false,
          path: fullPath
        })
      } catch (err) {
        console.error(`[插件解析失败] ${file}:`, err.message)
      }
    }
  }

  installedPlugins = list.sort((a, b) => a.name.localeCompare(b.name))
  return installedPlugins
}

scanPlugins()

// 配置文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PLUGINS_DIR),
  filename: (req, file, cb) => cb(null, file.originalname)
})
const upload = multer({ storage })

// ================= SQLite 存储接口 =================
app.get('/api/storage/:key', (req, res) => {
  const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(req.params.key)
  res.json({ value: row ? row.value : null })
})

app.post('/api/storage/:key', (req, res) => {
  const { key } = req.params
  const { value } = req.body
  if (value === null || value === undefined) {
    db.prepare('DELETE FROM kv_store WHERE key = ?').run(key)
  } else {
    db.prepare(`
      INSERT INTO kv_store (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, String(value))
  }
  res.json({ success: true })
})

// ================= 插件管理接口 =================
app.get('/api/plugins', (req, res) => {
  res.json(scanPlugins())
})

app.post('/api/plugins/upload', upload.single('plugin'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未上传文件' })
  res.json({ success: true })
})

app.post('/api/plugins/:id/toggle', (req, res) => {
  const file = req.params.id
  const p = installedPlugins.find(x => x.id === file)
  if (p) {
    p.enabled = req.body.enabled
    pluginConfig[file] = p.enabled
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(pluginConfig, null, 2))
  }
  res.json({ success: true })
})

app.delete('/api/plugins/:id', (req, res) => {
  const index = installedPlugins.findIndex(x => x.id === req.params.id)
  if (index > -1) {
    const p = installedPlugins[index]
    if (fs.existsSync(p.path)) {
      const stat = fs.statSync(p.path)
      if (stat.isFile() && p.path.includes('plugins' + path.sep) && !p.id.includes('.js')) {
        fs.rmSync(path.dirname(p.path), { recursive: true, force: true })
      } else {
        fs.unlinkSync(p.path)
      }
    }
    installedPlugins.splice(index, 1)
    delete pluginConfig[req.params.id]
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(pluginConfig, null, 2))
  }
  res.json({ success: true })
})

// ================= 代理获取模型列表 =================
app.get(['/api/tags', '/api/api/tags', '/api/v1/models'], async (req, res) => {
  try {
    const response = await axios.get('http://127.0.0.1:11434/api/tags')
    res.json(response.data)
  } catch (error) {
    res.json({ data: [], models: [] })
  }
})

// ================= 聊天代理接口 =================
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
    } catch (err) {
      console.error(`[插件执行报错] ${p.name}:`, err.message)
    }
  }

  if (directReply) {
    console.log('⚡ [后端] 直接发送插件数据，跳过大模型')
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    let isOpenAI = false
    if (targetUrl && targetUrl.includes('/v1/chat/completions')) isOpenAI = true

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
      method: 'post',
      url: finalTargetUrl,
      headers: targetHeaders,
      data: { ...restPayload, messages },
      responseType: 'stream',
      validateStatus: () => true 
    })

    if (response.status >= 400) {
      let errorMsg = `目标接口报错 HTTP ${response.status}`
      let errorData = ''
      response.data.on('data', chunk => { errorData += chunk.toString() })
      response.data.on('end', () => {
        try {
          const parsed = JSON.parse(errorData)
          errorMsg = parsed.error?.message || parsed.message || errorMsg
        } catch {}
        console.error(`❌ 云端大模型报错: ${errorMsg}`)
        res.status(response.status).json({ error: errorMsg })
      })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    response.data.pipe(res)
  } catch (error) {
    console.error('❌ 请求模型失败:', error.message)
    res.status(500).json({ error: `连接失败: ${error.message}` })
  }
})

const PORT = 3000
app.listen(PORT, () => console.log(`✅ 后端已启动，插件目录: ${PLUGINS_DIR}`))