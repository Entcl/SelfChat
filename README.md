# 🐟 大肥鱼 · AI 对话工作台 (SelfChat)

一个基于 **Vue 前端 + Node/Express 后端 + SQLite 持久化 + Electron 桌面壳 + 可热插拔的 JS/EXE 插件** 的现代化本地大模型工作台。
不仅拥有极光渐变与玻璃拟态的精致 UI，更具备**本地 SQLite 数据持久化**、**动态头像**、**混合模型架构（本地/云端单会话切换）**，以及强大的**后端插件拦截系统**（已完美兼容并迁移 AstrBot 插件生态）。

主形态是 **Windows 桌面应用**（Electron 壳 + 内嵌 Express 服务 + 本地网页），同时也能构建成纯静态站点部署到 GitHub Pages 供浏览器 / 手机预览。所有聊天记录、设置与 API Key 都留在自己机器上。

---

## ✨ 核心特性

### 🎨 界面与体验
- 玻璃拟态三栏式布局，深色 / 浅色 / 跟随系统主题。
- 极光渐变背景、圆角气泡、打字机流式输出。
- **个性化资料**：支持更换用户/AI头像（完美支持 GIF/WebP 动态头像），支持一键修改 AI 称呼并同步至侧边栏；AI 角色按「本地 / 云端」分别保存。
- 完整响应式适配，支持手机局域网访问。
- Windows 下自绘标题栏（最小化 / 最大化 / 关闭），PWA 可安装 + 离线静态资源缓存。

### 💬 对话与模型能力
- 多会话管理（新建、置顶、重命名、搜索、防重复新建）。
- **混合模型架构**：支持全局设置模型，也支持**单会话独立模型配置**（可在对话输入框左下角或顶部快捷切换本地 Ollama 与云端 DeepSeek/Kimi 等）。
- 本地走 Ollama 原生协议（`/api/chat`、`/api/tags`），云端走 OpenAI 兼容协议（`/v1/chat/completions`）；均支持 SSE 流式输出。
- 支持网络代理（仅 https 目标经 `HttpsProxyAgent` 转发，http 本地服务直连），模型列表由后端代取并带 SSRF 白名单防护。
- 快捷操作（重新生成、编辑并重发、复制、删除）。
- 系统提示词预设（简洁模式、代码助手、翻译润色）。

### 🖥️ 桌面与多工作区
- **多窗口 = 多工作区**：每个窗口对应一个稳定的 `w1` / `w2`… id 和独立 `persist:window-*` 分区，localStorage / IndexedDB / Cookie 物理隔离，互不串数据；重启自动恢复上次打开的窗口数。
- 单实例锁：再次双击图标不会多起进程，而是在同一进程内新开一个隔离窗口。
- 安全基线：`nodeIntegration: false` + `contextIsolation: true` + `sandbox: true`，渲染进程只通过 `preload.js` 的白名单 API 访问 KV 存储与窗口控制。

### 🔌 插件系统 (重大升级)
应用里有**两套互不干扰**的插件通道：

**① JS 插件**（`beforeChat` / `overrideTarget`）
- 支持**文件夹结构**的插件包，放入 `server/plugins` 目录即可自动识别；也支持单文件 `.js`。
- 入口文件名按 `main.js` → `index.js` → `<目录名>.js` 依次查找。
- 支持直接读取并渲染插件目录下的 `README.md` 文档。
- **直接拦截机制**：插件可以在 `beforeChat` 中直接返回结果（如天气查询），**跳过大模型生成，实现 0 延迟秒回**。
- **动态路由**：插件支持 `overrideTarget`，可实现"简单问题走本地，复杂问题走云端"的智能路由。
- 设置面板支持上传、启用/禁用、重命名、删除，插件显示名（alias）与启停状态写入 `plugins_config.json`。
- 内置 `plugins_compound_search`：精准天气查询 + `/websearch` 联网搜索（SearXNG），由 AstrBot 插件移植重构。

**② EXE 插件**（Python 脚本编译产物）
- 把任意 `.py` 脚本用 PyInstaller 打成 exe，Node 端按需 `spawn` 调用、**用完即焚**，无常驻进程、不占端口、不弹黑框。
- 与 JS 插件分开扫描、分开列表、单独开关；识别依据是目录内含 `_internal/` 或 `.exe`。
- 自带超时强杀（默认 10s）、stdout 上限（8MB）、UTF-8 → GBK 自动回退解码、参数安全校验。
- 完整打包流程见下方 [🧩 把 Python 脚本打包成 EXE 插件](#-把-python-脚本打包成-exe-插件重点)。

### 🗄️ 数据持久化
- 抛弃浏览器限制，全面接入本地 SQLite 数据库（`better-sqlite3`，单表 `kv_store` KV 存储）。
- 自动无缝迁移旧版 localStorage 历史数据，不怕清缓存，拒绝数据丢失；升级后旧的无命名空间数据也会自动收编到当前工作区。
- 桌面版数据目录为 `%APPDATA%\SelfChat\`（`app.getPath('userData')`），数据库、插件、插件配置都在这里，`release/` 打包时不会带走任何用户数据。

---

## 🛠️ 技术栈

| 层次 | 技术 |
| --- | --- |
| 前端 | Vue 3（Composition API，自写 store，无 vue-router / Pinia）、原生 CSS、自写 Markdown 渲染 |
| 构建 | Vite 8、`@vitejs/plugin-vue`，`base: './'`，`/api` 代理到 3000 |
| PWA | `public/manifest.webmanifest` + `sw.js` + 各尺寸图标（仅生产构建且非 Electron 时注册） |
| 桌面壳 | Electron 45（`main.js` 主进程 + `preload.js` 的 `contextBridge` 白名单） |
| 桌面打包 | electron-builder 26 → NSIS 安装包 + Portable 单文件；`asarUnpack` 解出 `better-sqlite3` 等原生模块 |
| 后端 | Node.js CommonJS + Express 4 + cors + multer + axios + `https-proxy-agent` |
| 数据库 | `better-sqlite3`（原生模块，预编译 `getKV` / `setKV`） |
| 大模型协议 | Ollama 原生协议 + OpenAI 兼容协议，SSE 流式输出 |
| EXE 插件 | Python 3（纯标准库）+ PyInstaller ≥ 6.0 + `child_process.spawn` |
| 部署 | GitHub Actions → GitHub Pages（Node 22，`npm ci --ignore-scripts`） |
| 开发辅助 | `concurrently` / `cross-env` / `wait-on`；`.npmrc` 配 npmmirror 国内镜像 |
| 协议 | Apache License 2.0 |

---

## 🏗️ 架构与目录结构

```
Electron main.js（单实例锁 / 多工作区 / 自绘标题栏）
  ├─ require('../server/index.js')  → Express :3000
  │     ├─ 静态托管 dist/           （Vue 构建产物）
  │     ├─ /api/storage/*           → SQLite KV
  │     ├─ /api/plugins*            → JS 插件扫描 / 上传 / 开关
  │     ├─ /api/plugins/exe         → EXE 插件清单
  │     ├─ /api/plugin-chat         → 插件拦截 → Ollama / DeepSeek
  │     ├─ /api/models              → 模型列表代理（SSRF 防护）
  │     └─ /api/local-python/*      → spawn(EXE 插件)
  └─ BrowserWindow → http://127.0.0.1:3000/?sc-workspace=w1
        └─ preload.js → window.electronAPI（KV / 工作区 / 窗口控制）
```

```
s-c/
├── electron/          # Electron 主进程、preload、package.json（CommonJS）
├── src/               # Vue 前端：components / store / api / utils / style.css
├── public/            # favicon、PWA 图标、manifest、sw.js
├── server/
│   ├── index.js       # Express 入口（插件扫描、聊天转发、上传、代理）
│   ├── db.js          # better-sqlite3 KV 封装
│   ├── routes/
│   │   ├── local-python.js   # EXE 插件 spawn 调用
│   │   └── exe-plugins.js    # EXE 插件扫描与识别
│   ├── plugins/       # 内置 JS 插件 + EXE 插件（开发期）
│   └── scripts/       # 插件配置清理脚本
├── python-service/    # EXE 插件的 Python 源码（业务 + CLI 外壳）
├── build/             # 应用图标 icon.png
├── release/           # electron-builder 产物（已 gitignore）
├── README-adshield.md # EXE 打包完整指南（379 行，本文件是它的精要版）
├── vite.config.js
└── package.json       # scripts + electron-builder 配置
```

---

## 🚀 快速开始

### 0. 环境准备
- Node.js 22+（GitHub Actions 用的版本）、npm
- Python 3.x（**只有打 EXE 插件时才需要**）
- [Ollama](https://ollama.com)（用本地模型时）

### 1. 安装并启动 Ollama
确保本机已安装 [Ollama](https://ollama.com) 并拉取了模型：
```bash
ollama serve
ollama pull qwen2.5:7b
```
> 只用云端模型（DeepSeek / Kimi 等 OpenAI 兼容服务）可以跳过这步，在设置面板里填写 `baseUrl` / `model` / API Key 即可。

### 2. 安装依赖
```powershell
npm install
```
> `.npmrc` 已把 npm / electron / electron-builder 的二进制指向国内镜像；`better-sqlite3` 是原生模块，若报编译问题可执行 `npm rebuild better-sqlite3`。

### 3. 开发运行

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 前端（默认 `http://localhost:5173`，`/api` 代理到 3000） |
| `node server/index.js` | 单独启动后端（`:3000`）并托管 `dist/` |
| `npm run build` | 构建前端到 `dist/`（纯静态预览产物） |
| `npm run electron:dev` | 并行启动 Vite 与 Electron（桌面调试） |
| `npm run electron:build` | `vite build` + `electron-builder`，产出桌面安装包 |

> 纯静态预览（GitHub Pages）**没有后端**：数据退回浏览器 localStorage，插件、SQLite 与本地模型代理不可用。推送到 `main` 后由 `.github/workflows/deploy-pages.yml` 自动构建并部署。

### 4. 打包成桌面 EXE
```powershell
npm run electron:build
```
产物在 `release/`：
- `SelfChat Setup <version>.exe` —— NSIS 安装包（可选安装目录、不需要管理员、卸载保留数据）
- `SelfChat_Portable_<version>.exe` —— 便携单文件
- `win-unpacked/SelfChat.exe` —— 免安装目录

打包配置集中在 `package.json` 的 `build` 字段（`appId`、`asarUnpack`、`files` 白名单、`win.target`、`nsis`、`portable`）。
**若要把 EXE 插件一起分发，打包前先把它放进 `server/plugins/`**（见下一节），否则安装版用户需要手动复制到 `%APPDATA%\SelfChat\plugins\`。

---

## 🔌 插件开发：JS 插件速览

最小插件（放入 `server/plugins/<你的插件名>/main.js`）：

```js
module.exports = {
  info: { name: 'my-plugin', version: '1.0.0', desc: '插件说明' },

  // 每次对话前触发
  async beforeChat(messages) {
    const text = messages[messages.length - 1]?.content || ''
    if (text.includes('ping')) {
      // 直接返回结果 → 跳过大模型，0 延迟秒回
      return { isDirectReply: true, content: 'pong 🏓' }
    }
    return messages // 不命中就原样放行
  },

  // 可选：动态改写目标模型
  async overrideTarget(messages, { targetUrl, targetHeaders }) {
    return { targetUrl, targetHeaders } // 或返回 { payload: {...} }
  },
}
```

- 同目录放 `README.md`，设置面板里点「文档」即可渲染。
- 旧版布尔值配置会自动升级成 `{ enabled, alias }` 对象；同名/改名残留会按 `info.name` 与归一化目录名自动去重。
- 上传接口支持单文件 `.js` 与多文件（保留相对路径的文件夹插件），并做了 `..` / 盘符 / UNC / NUL 路径穿越校验。

---

## 🧩 把 Python 脚本打包成 EXE 插件（重点）

> 想「写个 `.py` → 变成应用里能直接点开的插件」，走的就是这一节。
> 完整版（含原理、逐条排错、一键脚本）见 [README-adshield.md](README-adshield.md) 与 [python-service/README.md](python-service/README.md)。

### 8.1 先搞懂契约：应用怎么调用你的 exe

```
前端面板 → POST /api/local-python/search  { keyword: "参数" }
        → server/routes/local-python.js  resolveExe() 找到 exe
        → spawn(exePath, [keyword])      不走 shell；10 秒超时强杀；stdout 上限 8MB
        → 捕获 stdout（UTF-8 严格解码，失败自动回退 GBK）
        → 结果回显到界面
```

**你的脚本只要满足三条约定就能被直接调用：**

| 约定 | 说明 |
| --- | --- |
| ① 输入 | 从命令行参数 `argv[1]` 读输入（当前是单个 `keyword` 字符串） |
| ② 输出 | 结果 `print` / `sys.stdout.write` 到 **stdout** |
| ③ 错误 | 异常写 **stderr** 并返回**非 0 退出码**（缺参数 2 / 业务异常 1 / 装载失败 3） |

没有常驻进程、不占端口、不需要用户手动开终端。**业务层的「失败提示」仍算成功退出**（退出码 0），因为脚本本身跑完了，Node 端会把这段文字当正常结果显示。

### 8.2 为什么要多一层 CLI 外壳

`PyInstaller` 打包的是「程序入口」。业务 `.py` 一般只有函数，不会自己读 argv、也不会 print，所以需要一个薄薄的命令行外壳来衔接：

```
AdShield.exe ABCD1234
      ↓  argv[1]
adshield_cli.py  →  你的业务.search("ABCD1234")
      ↓  print 结果
stdout  →  Node 端捕获 → 界面
```

### 8.3 Step 1 · 写业务脚本

放 `python-service/你的业务.py`，**只写纯函数**，不读 argv、不 print：

```python
# my_business.py
def search(keyword: str) -> str:
    return f"✅ 收到参数：{keyword}"
```

### 8.4 Step 2 · 写 CLI 外壳

复制现成的 [`python-service/adshield_cli.py`](python-service/adshield_cli.py) 改一行 import 即可；它已经处理了 4 个坑：强制 UTF-8 输出（`--windowed` 下 stdout 可能是 `None`）、`ImportError` 兜底、返回值非字符串兼容、退出码语义。精简版如下：

```python
# -*- coding: utf-8 -*-
# my_cli.py —— 唯一的打包入口
import sys

# 必须在 import 业务模块之前强制 UTF-8，否则中文在中文 Windows 下会乱码
for name in ("stdout", "stderr"):
    s = getattr(sys, name, None)
    if s is None:
        import io, os
        setattr(sys, name, open(os.devnull, "w", encoding="utf-8"))
    else:
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

try:
    import my_business as biz          # ← 改成你的业务模块名
except Exception as exc:
    print(f"ImportError: 无法加载业务模块（{exc}）", file=sys.stderr)
    sys.exit(3)

def main(argv):
    if len(argv) < 2 or not argv[1].strip():
        print("用法: xxx.exe <参数>", file=sys.stderr)
        return 2
    try:
        result = biz.search(argv[1])
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    if result is None:
        print("业务函数返回了 None", file=sys.stderr)
        return 1
    text = result if isinstance(result, str) else str(result)
    sys.stdout.write(text + ("" if text.endswith("\n") else "\n"))
    sys.stdout.flush()
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

> ⚠️ **两个 `.py` 必须放在同一目录，并在该目录下执行打包命令**，否则 exe 里找不到业务模块。
> 业务脚本若 import 了私有/动态模块，打包时加 `--hidden-import 模块名`。

**先别急着打包**，2 秒验证外壳是对的：

```powershell
cd python-service
python my_cli.py ABCD1234        # 期望：✅ 收到参数：ABCD1234
python my_cli.py                 # 期望：stderr 用法说明，$LASTEXITCODE = 2
```

### 8.5 Step 3 · 安装 PyInstaller

```powershell
python -m pip install pyinstaller
# 国内慢就加镜像：
# python -m pip install pyinstaller -i https://pypi.tuna.tsinghua.edu.cn/simple

python -m PyInstaller --version   # 需 ≥ 6.0，--hide-console 是 6.x 才有的
```

### 8.6 Step 4 · 打包

**方式 A：目录版 `--onedir`（当前采用，推荐）** —— 启动 < 500ms、不往临时目录解压、杀软误报率低：

```powershell
cd C:\SOF\Program\SelfChat\s-c\python-service

python -m PyInstaller `
  --onedir `
  --console `
  --hide-console hide-early `
  --name AdShield `
  --distpath ..\dist-exe-dir `
  --workpath ..\.buildtmp\work `
  --specpath ..\.buildtmp `
  my_cli.py
```

产物：`dist-exe-dir\AdShield\`（约 23MB，内含 `AdShield.exe` + `_internal\`）。

**方式 B：单文件 `--onefile`（分发最省事）** —— 把 `--onedir` 换成 `--onefile`、`--distpath ..\dist-exe`，得到 `dist-exe\AdShield.exe`（约 10MB），但每次启动要解压到临时目录，首次 2–3 秒。

#### 参数为什么必须这么写

| 参数 | 原因 |
| --- | --- |
| `--onedir` / `--onefile` | 二选一，目录版 / 单文件版 |
| `--console` | **必须显式写出**，这是 exe 有 stdout 的前提 |
| `--hide-console hide-early` | 黑框消失的关键，且只在自己独占控制台（由 Node 启动）时隐藏；从已有终端手动运行仍正常显示，方便调试 |
| `--name AdShield` | 决定 **exe 文件名**，必须与 `local-python.js` 的 `EXE_NAME = 'AdShield.exe'` 一致；也决定 onedir 产物外层目录名 |
| `--distpath` / `--workpath` / `--specpath` | 产物与中间文件放到项目根的 `dist-exe*` / `.buildtmp`，不污染源码目录 |

> 🚫 **绝对不要用 `--noconsole` / `--windowed`**：实测 exe 的 stdout 会变成 `None`，`print` 全部被丢弃，Node 端永远拿到空字符串，前端一直报「插件没有返回任何内容」。正确组合是 `--console --hide-console hide-early`。

### 8.7 Step 5 · 改名 + 安装（决定能不能被扫到）

`--onedir` 的产物目录名 = `--name`，也就是 `AdShield\`；但路由找的是 `adshield_exe\`。
**别把 `--name` 直接改成 `adshield_exe`**（那样 exe 会叫 `adshield_exe.exe`，和 `EXE_NAME` 对不上），正确做法是打完包再改名：

```powershell
# 1) 改名
Rename-Item ..\dist-exe-dir\AdShield ..\dist-exe-dir\adshield_exe

# 2) 安装到开发期插件目录（整个目录一起复制，别漏 _internal）
New-Item -ItemType Directory -Force server\plugins\adshield_exe | Out-Null
Copy-Item ..\dist-exe-dir\adshield_exe\* server\plugins\adshield_exe\ -Recurse -Force
```

**最终结构必须是：**

```
server/plugins/adshield_exe/
├── AdShield.exe        ← 文件名不能变（路由按 EXE_NAME 找）
└── _internal/          ← PyInstaller onedir 固定标志，扫描器靠它识别 EXE 插件
```

扫描器（`server/routes/exe-plugins.js`）规则：目录含 `_internal/`，或目录内直接躺着 `.exe` → 判为 EXE 插件；**裸放在 plugins 根目录的单个 `.exe` 现在会被当作历史残留忽略**，所以别只丢一个 exe 进去。

**查找位置按优先级（命中第一个就停）：**

1. `%SELFCHAT_ADSHIELD_DIR%`（环境变量，调试用）
2. `%APPDATA%\SelfChat\plugins\`（**已安装版 SelfChat.exe 的运行时目录**）
3. `<项目>\server\plugins\`（开发期）

> `server/index.js` 启动时会把 `server/plugins/*` 递归复制到 `userData/plugins/*`，所以开发期放这里，打包运行时会自动出现。
> ⚠️ 复制逻辑是「**目标不存在才复制**」（`if (!fs.existsSync(destPath))`）——换了新版 exe 没生效，就手动删掉 `%APPDATA%\SelfChat\plugins\adshield_exe` 再重启。旧目录名 `AdShield\` 也建议删掉，避免占空间和困惑。

### 8.8 Step 6 · 自检 + 使用

```powershell
.\dist-exe-dir\adshield_exe\AdShield.exe ABCD1234
Write-Host "exit=$LASTEXITCODE"    # 期望 0；不弹新窗口，直接在当前终端输出结果

.\dist-exe-dir\adshield_exe\AdShield.exe          # 期望 stderr 用法说明，exit=2
```

然后重启应用 → 设置面板刷新插件 → EXE 插件卡片出现并可启用/禁用 → 打开对应面板输入参数，即走 `POST /api/local-python/search` 调用你的 exe。

### 8.9 一键脚本（建议落成文件）

把下面内容存成 `python-service/build-exe.ps1`，以后一条命令完成「打包 → 改名 → 自检 → 安装」：

```powershell
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $PSScriptRoot
$distDir = "$root\dist-exe-dir"; $buildDir = "$root\.buildtmp"
$pluginDir = "$root\server\plugins\adshield_exe"

python -m PyInstaller --version
Remove-Item $distDir, $buildDir -Recurse -Force -ErrorAction SilentlyContinue
python -m PyInstaller --onedir --console --hide-console hide-early `
  --name AdShield --distpath $distDir `
  --workpath "$buildDir\work" --specpath $buildDir my_cli.py
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller 打包失败' }

$built = Join-Path $distDir 'AdShield'
$final = Join-Path $distDir 'adshield_exe'
if (Test-Path $final) { Remove-Item $final -Recurse -Force }
Rename-Item $built $final

$out = & (Join-Path $final 'AdShield.exe') ABCD1234
Write-Host "自检输出: $out"
if (Test-Path $pluginDir) { Remove-Item $pluginDir -Recurse -Force }
New-Item -ItemType Directory -Force $pluginDir | Out-Null
Copy-Item "$final\*" $pluginDir -Recurse -Force
Write-Host "完成：$pluginDir\AdShield.exe"
Write-Host '安装版用户还需复制到：%APPDATA%\SelfChat\plugins\adshield_exe\'
```

执行：`powershell -ExecutionPolicy Bypass -File .\build-exe.ps1`

### 8.10 三条最容易忘的规则

1. **改了业务 `.py` 必须重新打包**。exe 是把 Python 代码和解释器一起封进去的静态产物，改源码不会影响已生成的 exe。
2. **换了 exe 不生效就删缓存目录**。应用「目标不存在才复制」，旧文件不会被覆盖。
3. **打包后要分发给用户，就把整个 `adshield_exe\` 目录放进 `%APPDATA%\SelfChat\plugins\adshield_exe\``，或在 `npm run electron:build` 之前放进 `server\plugins\` 一起打进安装包。

### 8.11 想接入第二个 / 多个脚本怎么办

当前 EXE 调用链是**单插件硬编码**：`EXE_NAME = 'AdShield.exe'`、目录名 `adshield_exe`、路由 `POST /api/local-python/search`、前端 `AdShieldPanel.vue`。所以再加一个不同业务的 exe 有两条路：

- **省事（推荐先这样）**：所有脚本共用一个 CLI 入口，用第一个参数做子命令分发，例如 `AdShield.exe weather 杭州` / `AdShield.exe code ABCD1234`，业务都封进同一个 exe，前端面板按参数区分。
- **规范**：仿照 `server/routes/local-python.js` 新增路由并在 `server/index.js` 挂载，用 `server/routes/exe-plugins.js` 的 `isExePluginEntry` 规则放行新目录，再配一个前端面板；不想改代码也可以用环境变量换名字（见下表）。

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `SELFCHAT_ADSHIELD_NAME` | `AdShield.exe` | 改 exe 文件名 |
| `SELFCHAT_ADSHIELD_DIRNAME` | `adshield_exe` | 改插件目录名 |
| `SELFCHAT_ADSHIELD_DIR` | — | 显式指定插件根目录（调试用，优先级最高） |
| `SELFCHAT_ADSHIELD_TIMEOUT_MS` | `10000` | 单次调用超时 |

### 8.12 常见问题

| 现象 | 原因 / 解法 |
| --- | --- |
| 前端报「插件没有返回任何内容」 | 99% 是用了 `--noconsole`。改回 `--console --hide-console hide-early` 重新打包 |
| 「插件未找到 / 文件不存在」 | 检查目录名是否为 `adshield_exe`、exe 名是否为 `AdShield.exe`、`_internal/` 是否一起复制；也可能是被杀软隔离 |
| 杀软报毒 / exe 被删 | PyInstaller bootloader 常被误判。加白名单、用 `--onedir`（不往临时目录释放文件，误报率明显更低）、或做代码签名 |
| 中文乱码 | CLI 已强制 UTF-8，路由端有 GBK 回退；检查业务脚本是否绕过 `print` 直接写 `sys.stdout.buffer` |
| `ImportError: 无法加载业务模块` | 两个 `.py` 不在同一目录 / 没在该目录执行打包；私有模块加 `--hidden-import` |
| 首次启动慢 2–3 秒 | `--onefile` 固有代价（每次解压到临时目录），在意速度就换 `--onedir` |
| exe 一闪黑框 | 少了 `--hide-console hide-early`，或 PyInstaller < 6.0 |

---

## 🗂️ 数据与配置

| 内容 | 位置 |
| --- | --- |
| 聊天记录 / 设置 / API Key | `%APPDATA%\SelfChat\data.sqlite`（`kv_store` 表） |
| 插件文件 | `%APPDATA%\SelfChat\plugins\`（运行时）、`server\plugins\`（开发期 / 内置） |
| 插件启停与别名 | `%APPDATA%\SelfChat\plugins_config.json` |
| 工作区注册表 | SQLite 里的 `sc.workspaces.v1` 键 |
| 桌面安装包 | `release/` |

`.gitignore` 已排除 `node_modules/`、`dist/`、`release/`、`*.sqlite`、`plugins_config.json`、`python-service/.venv/`、`__pycache__/` 与 `server/plugins/adshield_exe/`，**本地数据与密钥不会被提交**。

---

## 📄 License
This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
