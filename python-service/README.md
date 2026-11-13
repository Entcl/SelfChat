# python-service —— AdShield 激活码生成器（exe 源码）

这里存放 **AdShield.exe 的源码**。它不再是一个 HTTP 服务，而是被 Node 端
按需 `spawn` 调用的命令行程序。

```
python-service/
├── ADShieldCodeGenerate.py   ← 业务逻辑（激活码算法）
├── adshield_cli.py           ← 命令行入口（读 argv → 调业务 → print）
└── requirements.txt          ← 没有任何三方依赖（纯标准库）
```

> 历史说明：这个目录曾经装的是 FastAPI 微服务（`main.py` + `search_tool.py`），
> 已于架构切换时移除。现在没有常驻进程、不占用端口。

## 两个文件的分工

| 文件 | 职责 | 改动频率 |
| --- | --- | --- |
| `ADShieldCodeGenerate.py` | 算激活码：`search(keyword) -> str` | 业务变更时改 |
| `adshield_cli.py` | 读命令行参数、打印结果、错误退出码 | 一般不用动 |

调用链：

```
AdShield.exe ABCD1234
      ↓
adshield_cli.py         读 argv[1]
      ↓
ADShieldCodeGenerate.search("ABCD1234")
      ↓
stdout（Node 端捕获作为结果）
```

## 本地直接跑（不打包，调试用）

```powershell
cd python-service

python adshield_cli.py ABCD1234
# ✅ 设备 ABCD1234 的激活码：\n1802339259-DA3F6C41

python adshield_cli.py "ABCD1234,1730000000"
# 续费格式：第二个参数是原到期时间戳

python adshield_cli.py
# 缺参数 → stderr 输出用法，退出码 2
```

## 打包成 exe

完整步骤见项目根的 **[README-adshield.md](../README-adshield.md)**。最快路径：

```powershell
python -m PyInstaller `
  --onedir --console --hide-console hide-early `
  --name AdShield `
  --distpath ..\dist-exe-dir `
  --workpath ..\.buildtmp\work `
  --specpath ..\.buildtmp `
  adshield_cli.py

# PyInstaller 用 --name 命名产物目录，改成路由约定的名字
Rename-Item ..\dist-exe-dir\AdShield ..\dist-exe-dir\adshield_exe
```

然后把 `dist-exe-dir\adshield_exe\` 整个目录复制到 `server/plugins/adshield_exe\`。

## 改完源码必须重新打包

exe 是把业务代码和 Python 解释器一起封进去的静态产物。
改了 `ADShieldCodeGenerate.py` 之后，**必须重新执行包**，否则运行的是旧逻辑。

## 常见问题

- **`ImportError: 无法加载 ADShieldCodeGenerate`**：打包时两个 .py 不在同一目录。
  必须在 `python-service/` 目录下执行打包命令。
- **exe 没输出**：打包时漏了 `--console`。见 README-adshield.md 第 5 节。
