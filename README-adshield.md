# AdShield.exe 打包指南

把 `python-service/ADShieldCodeGenerate.py` 打成**可以接收命令行参数、且不弹黑框**的 `AdShield.exe`。

---

## 一、原理：为什么要多一个 `adshield_cli.py`

`ADShieldCodeGenerate.py` 里只有业务函数 `search(keyword)`，它**不会自己读命令行参数、也不会 print**。
PyInstaller 打包的是「程序入口」，所以需要一个薄薄的命令行外壳来衔接：

```
AdShield.exe ABCD1234
      ↓  argv[1]
adshield_cli.py  →  ADShieldCodeGenerate.search("ABCD1234")
      ↓  print 结果
stdout
```

对应关系：

| 你的业务 | 谁负责 |
| --- | --- |
| 算激活码 | `ADShieldCodeGenerate.py`（**完全不动**） |
| 读命令行参数、print、错误退出 | `adshield_cli.py`（已提供） |
| 打包成 exe | PyInstaller |

---

## 二、目录准备

确认这两个文件在同一个目录（`python-service/`）：

```
python-service/
├── ADShieldCodeGenerate.py   ← 你的业务脚本（不改）
└── adshield_cli.py    ← 命令行入口（已提供）
```

`adshield_cli.py` 里已经处理了三件容易踩坑的事：

1. **强制 UTF-8 输出**：`--windowed` 模式下 stdout 可能是 `None`，直接 print 会崩掉且不报错。
2. **`ImportError` 兜底**：打包漏了模块时，写 stderr 并以退出码 3 退出，Node 端能读到原因。
3. **返回非字符串的兼容**：`search()` 万一 return 了 `None` 或数字，不会崩。

---

## 三、安装 PyInstaller

```powershell
cd C:\SOF\Program\SelfChat\s-c\python-service
python -m pip install pyinstaller
```

国内网络慢：

```powershell
python -m pip install pyinstaller -i https://pypi.tuna.tsinghua.edu.cn/simple
```

验证：

```powershell
python -m PyInstaller --version
# 应输出类似 6.22.3
```

> **需要 PyInstaller ≥ 6.0**。`--hide-console` 参数是 6.x 才有的，第 5 节会用到。

---

## 四、先不打包，直接验证逻辑

打包要几十秒，先花 2 秒确认 CLI 外壳是对的：

```powershell
cd python-service

python adshield_cli.py ABCD1234
# 期望：✅ 设备 ABCD1234 的激活码：\n1802335358-8297CF32

python adshield_cli.py "ABCD1234,1730000000"
# 期望：同上（续费格式）

python adshield_cli.py
# 期望：stderr 输出用法说明，$LASTEXITCODE 为 2

python adshield_cli.py BAD
# 期望：❌ 设备 ID 'BAD' 格式错误...（这是业务失败，退出码仍是 0）
```

最后一条注意：**业务层的「失败」不算进程失败**。`search()` 返回一段以 ❌ 开头的文字时，
CLI 依然返回退出码 0 —— 因为脚本正常跑完了。Node 端会把这段文字当正常结果显示。
只有真正的异常（Python 抛错）才会走 stderr + 非零退出码。

---

## 五、打包

### 方式 A：单文件（推荐，分发最简单）

```powershell
cd C:\SOF\Program\SelfChat\s-c\python-service

python -m PyInstaller `
  --onefile `
  --console `
  --hide-console hide-early `
  --name AdShield `
  --distpath ..\dist-exe `
  --workpath ..\.buildtmp\work `
  --specpath ..\.buildtmp `
  adshield_cli.py
```

产物：`dist-exe\AdShield.exe`（约 10 MB，单文件）

### 方式 B：目录版（当前采用，启动更快，免解压）

```powershell
cd C:\SOF\Program\SelfChat\s-c\python-service

python -m PyInstaller `
  --onedir `
  --console `
  --hide-console hide-early `
  --name AdShield `
  --distpath ..\dist-exe-dir `
  --workpath ..\.buildtmp\work2 `
  --specpath ..\.buildtmp `
  adshield_cli.py
```

产物：`dist-exe-dir\AdShield\`（约 23 MB，内含 `AdShield.exe` + `_internal\`）

> **注意**：PyInstaller 的 `--onedir` 会把产物放进一个**以 `--name` 命名**的目录，
> 所以这里得到的目录叫 `AdShield\`，不是我们要的 `adshield_exe\`。
> 如果你把 `--name` 直接改成 `adshield_exe`，exe 本身会变成 `adshield_exe.exe`，
> 和路由里约定的 `EXE_NAME = 'AdShield.exe'` 对不上，插件会加载失败。
>
> **正确做法：`--name` 保持 `AdShield`，打完包再把目录改名为 `adshield_exe`**（见第 7 节）。

**两种方式路由都支持**，放哪个都行（见第 7 节）。

### 关键参数解释

| 参数 | 为什么必须写 |
| --- | --- |
| `--onefile` / `--onedir` | 单文件 / 目录版，按需选一个 |
| `--console` | **必须显式写出**。这是让 exe 有 stdout 的前提；不写或写 `--windowed` 会导致拿不到任何输出 |
| `--hide-console hide-early` | 黑框消失的关键。**只有在自己独占控制台时（即由 Node 启动）才隐藏**；如果你从已有终端手动运行，窗口正常显示，方便调试 |
| `--name AdShield` | **产物名（含 exe 文件名）**，必须和路由里的 `EXE_NAME` 一致。目录版的外层目录名由它决定，之后我们再改名成 `adshield_exe` |
| `--distpath` | 产物目录。我习惯放项目根的 `dist-exe`，避免污染源码目录 |
| `--workpath` / `--specpath` | 把中间产物丢到 `.buildtmp`，不要留在 `python-service/` 里 |

### ⚠️ 不要用 `--noconsole` / `--windowed`

这是最容易踩的坑。我实测过：

```powershell
# 错误用法
python -m PyInstaller --onefile --noconsole --name AdShield adshield_cli.py
```

跑出来确实**不弹黑框**，但 exe 的 stdout 是 `None`，
`print()` 全部被丢弃 —— Node 端拿到空字符串，永远报「插件没有返回任何内容」。

正确做法是 `--console --hide-console hide-early`：既有 stdout，又不弹窗。

---

## 六、验证 exe

```powershell
cd C:\SOF\Program\SelfChat\s-c

# 单文件版
.\dist-exe\AdShield.exe ABCD1234
# 期望：✅ 设备 ABCD1234 的激活码：\n...

# 目录版
.\dist-exe-dir\adshield_exe\AdShield.exe ABCD1234
```

**期望表现**：不弹新窗口，直接在**当前终端**里输出结果。
（`hide-early` 只隐藏自己新建的控制台，不会抢你已经开着的终端。）

检查退出码：

```powershell
.\dist-exe\AdShield.exe ABCD1234
Write-Host "exit=$LASTEXITCODE"     # 期望 0

.\dist-exe\AdShield.exe BAD
Write-Host "exit=$LASTEXITCODE"     # 期望 0（业务失败）

.\dist-exe\AdShield.exe
Write-Host "exit=$LASTEXITCODE"     # 期望 2（缺参数）
```

---

## 七、放到插件目录

路由会按顺序找这几个位置，**命中第一个就停**：

```
每个插件根目录（$env:SELFCHAT_ADSHIELD_DIR / <userData>\plugins / <项目>\server\plugins）
下依次尝试：

  <root>\adshield_exe\AdShield.exe      ← 当前约定（onedir）
  <root>\AdShield\AdShield.exe          ← 历史目录名，向后兼容
  <root>\AdShield.exe                   ← 单文件版，向后兼容
```

「插件根目录」按优先级：

1. `$env:SELFCHAT_ADSHIELD_DIR`（环境变量，调试用）
2. `<userData>\plugins`（Electron 打包后的运行时目录，通常是 `%APPDATA%\SelfChat\plugins`）
3. `<项目>\server\plugins`（开发期）

### 目录版改名 + 安装（推荐）

PyInstaller 打出来的目录叫 `AdShield\`，改名成 `adshield_exe\` 再放进去：

```powershell
# 1) 改名（在 dist-exe-dir 下把 AdShield 改成 adshield_exe）
Rename-Item dist-exe-dir\AdShield adshield_exe

# 2) 安装到开发期插件目录
New-Item -ItemType Directory -Force server\plugins\adshield_exe | Out-Null
Copy-Item dist-exe-dir\adshield_exe\* server\plugins\adshield_exe\ -Recurse -Force
```

最终结构必须是：

```
server/plugins/adshield_exe/
├── AdShield.exe        ← 文件名不能变（路由按 EXE_NAME 找）
└── _internal/          ← 整个目录一起复制，别漏
```

### 单文件版安装

```powershell
Copy-Item dist-exe\AdShield.exe server\plugins\ -Force
```

`server/index.js` 启动时会把 `server/plugins/*` **递归复制**到 `userData/plugins/*`，
所以这两个位置等价。

> 注意：`index.js` 的复制逻辑是「目标不存在才复制」（`if (!fs.existsSync(destPath))`）。
> 换了新版 exe 后如果没生效，手动删掉 `userData/plugins/adshield_exe` 再重启。

> ⚠️ 从旧目录名升级时，`userData/plugins/` 下可能还留着旧的 `AdShield\` 目录。
> 路由虽然兼容它，但**旧目录会排在新目录后面**，所以不会抢跑；
> 建议直接删掉旧的 `AdShield\`，避免占空间和困惑。

### 打包发布后（已安装的 SelfChat.exe）

把整个 `adshield_exe\` 目录放到：

```
%APPDATA%\SelfChat\plugins\adshield_exe\
```

（`app.getPath('userData')` 默认就是这里，具体看 `server/index.js` 打印的「数据目录」）

---

## 八、常见问题

### Q1: 杀毒软件报毒 / exe 一放进去就被删

PyInstaller 的 bootloader 被某些杀软误判是常态（它确实会「释放文件到临时目录并执行」）。
应对：

- 加白名单
- 用目录版（`--onedir`）—— 它不往临时目录释放文件，误报率明显更低
- 考虑代码签名证书

路由对这种情况有专门处理，前端会显示：

> 插件文件不存在（可能被杀毒软件隔离），请重新安装

### Q2: 输出中文变乱码

`adshield_cli.py` 已经强制 UTF-8，路由端也做了 **UTF-8 → GBK 自动回退**解码，正常不会乱码。
如果你看到乱码，检查是不是自己在 `ADShieldCodeGenerate.py` 里直接 `sys.stdout.buffer.write(...)` 绕过了编码设置。

### Q3: 报「插件没有返回任何内容」

99% 是因为用了 `--noconsole`。改回 `--console --hide-console hide-early` 重新打包。

### Q4: 提示 `ImportError: 无法加载 ADShieldCodeGenerate`

exe 找不到业务模块。确认打包时 `adshield_cli.py` 和 `ADShieldCodeGenerate.py` **在同一目录**，
并且在那个目录下执行打包命令。如果 `ADShieldCodeGenerate.py` 还 import 了私有模块，需要加：

```powershell
--hidden-import 你的模块名
```

### Q5: exe 跑起来很慢（首次 2-3 秒）

`--onefile` 每次启动都要解压到临时目录，这是它固有的代价。
在意启动速度就用 `--onedir`，只在第一次加载 DLL，通常 < 500ms。

### Q6: 改了 `ADShieldCodeGenerate.py` 之后要重新打包吗

**要。** exe 是把 Python 代码和解释器一起封进去的静态产物，改源码不会影响已生成的 exe。

---

## 九、一键脚本

在 `python-service/` 下新建 `build-exe.ps1`，一条命令完成「打包 → 改名 → 自检 → 安装」：

```powershell
#!/usr/bin/env pwsh
# 打包 AdShield.exe（onedir 模式）并自动安装到 server/plugins/adshield_exe

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $PSScriptRoot

$distDir  = "$root\dist-exe-dir"
$buildDir = "$root\.buildtmp"
$pluginDir = "$root\server\plugins\adshield_exe"

Write-Host '=== 1/5 检查 PyInstaller ===' -ForegroundColor Cyan
python -m PyInstaller --version

Write-Host '=== 2/5 清理旧产物 ===' -ForegroundColor Cyan
Remove-Item $distDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $buildDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host '=== 3/5 打包（onedir）===' -ForegroundColor Cyan
python -m PyInstaller `
  --onedir `
  --console `
  --hide-console hide-early `
  --name AdShield `
  --distpath $distDir `
  --workpath "$buildDir\work" `
  --specpath $buildDir `
  adshield_cli.py

if ($LASTEXITCODE -ne 0) { throw 'PyInstaller 打包失败' }

# PyInstaller 用 --name 命名产物目录，这里改成路由约定的 adshield_exe
Write-Host '=== 4/5 改名为 adshield_exe ===' -ForegroundColor Cyan
$built = Join-Path $distDir 'AdShield'
$final = Join-Path $distDir 'adshield_exe'
if (Test-Path $final) { Remove-Item $final -Recurse -Force }
Rename-Item $built $final

Write-Host '=== 5/5 自检 + 安装 ===' -ForegroundColor Cyan
$exe = Join-Path $final 'AdShield.exe'
$out = & $exe ABCD1234
Write-Host "自检输出: $out"

if (Test-Path $pluginDir) { Remove-Item $pluginDir -Recurse -Force }
New-Item -ItemType Directory -Force $pluginDir | Out-Null
Copy-Item "$final\*" $pluginDir -Recurse -Force

Write-Host '=== 完成 ===' -ForegroundColor Green
Write-Host "产物: $exe"
Write-Host "已安装到: $pluginDir\AdShield.exe"
Write-Host ''
Write-Host '提示：若用的是已安装版 SelfChat，还需把整个 adshield_exe 目录复制到：'
Write-Host '      %APPDATA%\SelfChat\plugins\adshield_exe\'
```

执行：

```powershell
.\build-exe.ps1
```
