# -*- coding: utf-8 -*-
"""
adshield_cli.py —— AdShield.exe 的命令行入口
============================================================

这个文件**只负责命令行这一层**：读 argv → 调用业务函数 → 打印结果 / 报错退出。
你的业务逻辑继续留在 ADShieldCodeGenerate.py 里，不要动。

用法（打包后）：
    AdShield.exe ABCD1234
    AdShield.exe "ABCD1234,1730000000"

输出约定（Node 端就是按这个约定解析的）：
    成功  → 结果文本写 stdout，退出码 0
    失败  → 错误信息写 stderr，退出码非 0
    缺参数 → 用法说明写 stderr，退出码 2

打包命令见 README-adshield.md。
"""

from __future__ import annotations

import sys

# ============================================================
# 编码：必须在 import 业务模块之前处理
# ============================================================
# PyInstaller 的 --windowed 模式下没有真正的控制台，stdout 可能被重定向到
# 一个 None 或非法编码的流。这里强制 UTF-8，避免中文变乱码或直接抛
# UnicodeEncodeError（在 windowed 模式下这会静默失败，非常难查）。
def _force_utf8_stdio() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            # windowed 模式下可能为 None，用 os.devnull 顶上，防止后续 print 崩溃
            import io
            import os

            setattr(sys, stream_name, open(os.devnull, "w", encoding="utf-8"))
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            # 老版本 Python 或被接管过的流，忽略即可
            pass


_force_utf8_stdio()


# ============================================================
# 业务入口
# ============================================================
# 业务模块：ADShieldCodeGenerate.py（原名 search_tool.py）
# 用模块别名导入，调用点写成 codegen.search(...)，一眼能看出来源。
try:
    import ADShieldCodeGenerate as codegen
except Exception as exc:  # 打包漏文件 / 依赖缺失
    print(
        f"ImportError: 无法加载 ADShieldCodeGenerate（{type(exc).__name__}: {exc}）",
        file=sys.stderr,
    )
    sys.exit(3)

# 启动时就把入口函数解析出来：模块能 import 但缺 search() 也算安装损坏，
# 提前失败比每次请求都报错好定位。
_search = getattr(codegen, "search", None)
if not callable(_search):
    print(
        "ImportError: ADShieldCodeGenerate 中没有可调用的 search(keyword) 函数",
        file=sys.stderr,
    )
    sys.exit(3)


USAGE = "用法: AdShield.exe <设备ID>  或  AdShield.exe \"设备ID,原到期时间戳\""


def main(argv: list[str]) -> int:
    # argv[0] 是 exe 自身路径
    args = argv[1:]

    if not args or not args[0].strip():
        print(USAGE, file=sys.stderr)
        return 2

    keyword = args[0]

    try:
        # codegen.search(...) —— 业务函数来自 ADShieldCodeGenerate.py
        result = codegen.search(keyword)
    except Exception as exc:
        # 业务函数抛异常 → stderr + 非零退出码，Node 端会读 stderr 并翻译
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    if result is None:
        print("业务函数返回了 None，没有可输出的内容", file=sys.stderr)
        return 1

    # 兼容业务函数返回非字符串的情况
    text = result if isinstance(result, str) else str(result)

    # 注意：结果里如果带 ❌ / ✅ 这类业务层面的「失败提示」，仍然算成功退出。
    # 因为那是业务逻辑的一部分，不是进程执行失败。
    sys.stdout.write(text)
    if not text.endswith("\n"):
        sys.stdout.write("\n")
    sys.stdout.flush()

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
