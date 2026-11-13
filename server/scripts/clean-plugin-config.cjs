/**
 * plugins_config.json 清理工具
 *
 * 背景：插件目录改名（compound_search → plugins_compound_search、
 * AdShield → adshield_exe）后，旧 key 会一直留在配置里。
 * 它们不再对应任何真实插件，属于无害但碍眼的脏数据。
 *
 * 运行：node server/scripts/clean-plugin-config.cjs [--dry]
 * 会删除所有不对应任何现存插件目录的 key。
 */
const fs = require('fs')
const path = require('path')

const userDataDir = process.argv.includes('--userdata')
  ? path.join(process.env.APPDATA || '', 's-c')
  : path.join(__dirname, '..')

const pluginsDir = path.join(userDataDir, 'plugins')
const configPath = path.join(userDataDir, 'plugins_config.json')
const dryRun = process.argv.includes('--dry')

if (!fs.existsSync(configPath)) {
  console.log('配置文件不存在，无需清理:', configPath)
  process.exit(0)
}

let config
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
} catch (err) {
  console.error('配置文件解析失败:', err.message)
  process.exit(1)
}

// 现存插件名集合（目录名 + 可能的单文件 js 名）
const alive = new Set()
try {
  for (const name of fs.readdirSync(pluginsDir)) {
    alive.add(name)
    if (name.endsWith('.js')) alive.add(name.replace(/\.js$/, ''))
  }
} catch {
  console.error('插件目录不存在:', pluginsDir)
  process.exit(1)
}

const removed = []
const kept = {}
for (const [key, value] of Object.entries(config)) {
  if (alive.has(key)) {
    kept[key] = value
  } else {
    removed.push(key)
  }
}

console.log('插件目录 :', pluginsDir)
console.log('配置里现存插件:', [...alive].join(', '))
console.log('')
if (removed.length === 0) {
  console.log('没有需要清理的 key')
  process.exit(0)
}

console.log('将删除的失效 key:')
removed.forEach((k) => console.log('  -', k))

if (dryRun) {
  console.log('\n[--dry] 未写入')
  process.exit(0)
}

fs.writeFileSync(configPath, JSON.stringify(kept, null, 2), 'utf-8')
console.log('\n已写入:', configPath)
console.log('剩余:', JSON.stringify(kept))
