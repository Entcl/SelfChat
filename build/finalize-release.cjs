#!/usr/bin/env node
/**
 * finalize-release.cjs — 让 `release/` 目录里**只保留压缩包**。
 *
 * 背景：本项目自 2026-11-24 起改为「只产出 zip」的分发形态。
 * `electron-builder --win zip` 除了目标 zip 之外，还会留下 `win-unpacked/`、
 * `builder-debug.yml`、`builder-effective-config.yaml`、`.icon-ico/` 等中间产物，
 * 以及历史遗留的 `SelfChat Setup x.y.z.exe` / `SelfChat_Portable_x.y.z.exe`。
 *
 * 本脚本在打包结束后运行，做三件事：
 *   1. 校验：`release/` 里必须**恰好有一个** .zip，否则报错退出（不静默通过）；
 *   2. 清理：删掉除该 zip 以外的全部内容（安装包 exe、blockmap、yml、win-unpacked…）；
 *   3. 体检：用系统自带 `tar` 列出 zip 内容，确认根下有 `SelfChat.exe` 与
 *      `resources/app.asar`，即「解压后可直接双击运行」。
 *
 * 用法（已挂在 npm run electron:build 末尾）：
 *   node build/finalize-release.cjs
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const RELEASE = path.join(ROOT, 'release')

/** 打包后必须存在的目录/文件（相对 zip 根） */
const REQUIRED_ENTRIES = ['SelfChat.exe', 'resources/app.asar']

function fail(msg) {
  console.error(`\n[finalize-release] ✗ ${msg}`)
  process.exit(1)
}

function human(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 递归删除，失败不致命（可能被占用），只记录 */
function removeEntry(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 })
    return true
  } catch (err) {
    console.warn(`[finalize-release] ! 删除失败（可能被占用）：${path.basename(target)} — ${err.message}`)
    return false
  }
}

/**
 * 用 Windows 自带的 bsdtar 列出 zip 条目。
 * 拿不到就返回 null —— 体检降级为「跳过」，绝不让它把成功的打包判成失败。
 */
function listZipEntries(zipPath) {
  try {
    const out = execFileSync('tar', ['-tf', zipPath], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    })
    return out.split(/\r?\n/).filter(Boolean)
  } catch (err) {
    console.warn(`[finalize-release] ! 无法列出 zip 内容（跳过体检）：${err.message}`)
    return null
  }
}

/**
 * 判断 zip 是「文件直接铺在根」还是「外面套了一层目录」。
 * 返回 { prefix, entries }，prefix 为 '' 或 'SelfChat/'。
 */
function detectLayout(entries) {
  const tops = new Set(entries.map((e) => e.split('/')[0]))
  const hasRootExe = tops.has('SelfChat.exe')
  if (hasRootExe) return { prefix: '', entries }
  // 只有唯一顶层目录 → 视为套了一层
  if (tops.size === 1) {
    const only = [...tops][0]
    if (entries.some((e) => e === `${only}/` || e.startsWith(`${only}/`))) {
      return { prefix: `${only}/`, entries }
    }
  }
  return { prefix: '', entries }
}

function main() {
  if (!fs.existsSync(RELEASE)) fail(`release 目录不存在：${RELEASE}`)

  const all = fs.readdirSync(RELEASE)
  const zips = all.filter((n) => n.toLowerCase().endsWith('.zip'))

  if (zips.length === 0) {
    fail('release/ 里没有找到任何 .zip 产物，请检查 electron-builder 是否成功执行 `--win zip`')
  }
  if (zips.length > 1) {
    fail(`release/ 里有 ${zips.length} 个 zip（${zips.join(', ')}），无法确定唯一分发件`)
  }

  const zipName = zips[0]
  const zipPath = path.join(RELEASE, zipName)

  // ---------- 1. 清理：只留这一个 zip ----------
  const removed = []
  const kept = []
  for (const name of all) {
    if (name === zipName) {
      kept.push(name)
      continue
    }
    const target = path.join(RELEASE, name)
    const isDir = fs.statSync(target).isDirectory()
    if (removeEntry(target)) removed.push(isDir ? `${name}/` : name)
  }

  // ---------- 2. 体检：解压即可运行 ----------
  const entries = listZipEntries(zipPath)
  let layout = null
  if (entries) {
    layout = detectLayout(entries)
    const missing = REQUIRED_ENTRIES.filter(
      (rel) => !entries.includes(`${layout.prefix}${rel}`),
    )
    if (missing.length) {
      fail(`zip 内缺少关键文件：${missing.join(', ')}（压缩包不完整，解压后无法直接运行）`)
    }
  }

  // ---------- 3. 报告 ----------
  const size = fs.statSync(zipPath).size
  console.log('')
  console.log('[finalize-release] ✅ release/ 已收敛为单一压缩包')
  console.log(`  产物   : release/${zipName}`)
  console.log(`  体积   : ${human(size)} (${size} 字节)`)
  if (removed.length) {
    console.log(`  已清理 : ${removed.length} 项 —— ${removed.join(', ')}`)
  } else {
    console.log('  已清理 : 无（目录本来就是干净的）')
  }
  if (layout) {
    const where = layout.prefix
      ? `压缩包内含顶层目录 "${layout.prefix.replace(/\/$/, '')}/"`
      : '压缩包内文件直接位于根目录'
    console.log(`  结构   : ${where}；${REQUIRED_ENTRIES.join(' / ')} 均在位`)
    console.log(
      `  使用   : 解压到固定目录后，双击 ${
        layout.prefix ? `${layout.prefix.replace(/\/$/, '')}/` : ''
      }SelfChat.exe 即可运行`,
    )
  }
  console.log('')
}

main()
