<script setup>
/**
 * AdShieldModal —— AdShield 激活码操作控制台
 * ============================================================
 * 一个居中的模态弹窗（不再是右侧滑出面板），因为它的入口现在在
 * 「设置 → 插件管理 → EXE 插件」的卡片里，属于弹窗嵌套场景。
 *
 * 层级：设置面板 z-index 80，本弹窗 120，保证永远盖在设置之上。
 *
 * 链路：本组件 → /api/local-python/* → Node → spawn(AdShield.exe, [keyword])
 * 没有任何常驻服务、不占用端口、不需要用户手动开终端。
 * ============================================================
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { checkPythonHealth, generateActivationCode } from '../api/localPython'
import { toast } from '../store/toast'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

// ---------------------------------------------------------------- 状态灯
// 'checking' | 'alive' | 'degraded' | 'down'
//   alive    : exe 存在且非空 → 绿点
//   degraded : exe 存在但 0 字节（安装损坏）→ 黄点
//   down     : exe 不存在 → 红点
const healthState = ref('checking')
const healthMessage = ref('正在检测插件…')
const checking = ref(false)
// 插件元信息（路径/大小/打包布局），用于悬浮提示与排错
const pluginInfo = ref(null)

const healthDotClass = computed(() => `is-${healthState.value}`)
const healthLabel = computed(() => {
  if (healthState.value === 'alive') return '插件已就绪'
  if (healthState.value === 'degraded') return '插件已损坏'
  if (healthState.value === 'down') return '插件未找到'
  return '检测中…'
})

let healthTimer = null

async function refreshHealth() {
  if (checking.value) return
  checking.value = true
  try {
    const result = await checkPythonHealth()
    pluginInfo.value = result.plugin || null
    if (result.alive) {
      healthState.value = 'alive'
      healthMessage.value = '插件已就绪'
    } else if (result.degraded) {
      healthState.value = 'degraded'
      healthMessage.value = result.message
    } else {
      healthState.value = 'down'
      healthMessage.value = result.message
    }
  } finally {
    checking.value = false
  }
}

/** 长轮询：面板打开时每 15 秒探一次，关掉就停，不白白烧 CPU */
function startHealthPolling() {
  stopHealthPolling()
  healthTimer = setInterval(refreshHealth, 15_000)
}

function stopHealthPolling() {
  if (healthTimer) {
    clearInterval(healthTimer)
    healthTimer = null
  }
}

// ---------------------------------------------------------------- 生成
const keyword = ref('')
const loading = ref(false)
const resultText = ref('')
const resultMeta = ref(null)
const errorText = ref('')
const copied = ref(false)

// 输入是否合法：非空即可（真正的 8 位校验交给 exe 内部，这里只做轻提示）
const canSubmit = computed(() => keyword.value.trim().length > 0 && !loading.value)

// 轻量防抖：同一输入在 400ms 内重复点击直接忽略
let lastSubmitAt = 0

async function onSubmit() {
  if (!canSubmit.value) return

  const now = Date.now()
  if (now - lastSubmitAt < 400) return
  lastSubmitAt = now

  loading.value = true
  errorText.value = ''
  copied.value = false

  try {
    const data = await generateActivationCode(keyword.value)
    resultText.value = data.result
    resultMeta.value = data
    toast.success(`激活码已生成（${data.elapsedMs}ms）`)
  } catch (err) {
    resultText.value = ''
    resultMeta.value = null
    errorText.value = err.message || '生成失败'

    // 插件层面的问题，顺手把状态灯刷成对应颜色，用户不用再点一次刷新
    if (err.code === 'PLUGIN_NOT_FOUND') {
      healthState.value = 'down'
      healthMessage.value = err.message
      pluginInfo.value = null
    } else if (err.code === 'PLUGIN_EMPTY') {
      healthState.value = 'degraded'
      healthMessage.value = err.message
    } else if (err.code === 'PLUGIN_TIMEOUT') {
      // 超时不算插件坏了：exe 可能只是这次跑得慢，保持绿点但提示超时
      healthMessage.value = err.message
    }

    toast.error(err.message || '生成失败')
  } finally {
    loading.value = false
  }
}

/** 回车即提交，省得每次都要挪鼠标 */
function onKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    onSubmit()
  }
}

// ---------------------------------------------------------------- 复制
const copySupported = computed(() => typeof navigator !== 'undefined' && !!navigator.clipboard)

async function copyResult() {
  const text = resultText.value
  if (!text) return
  try {
    if (copySupported.value) {
      await navigator.clipboard.writeText(text)
    } else {
      // Electron 里 clipboard API 偶尔受权限策略影响，降级到 execCommand
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    copied.value = true
    toast.success('已复制到剪贴板')
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    toast.error('复制失败，请手动选中文本复制')
  }
}

function clearAll() {
  keyword.value = ''
  resultText.value = ''
  resultMeta.value = null
  errorText.value = ''
}

/**
 * 耗时展示。激活码生成常常 <1ms，直接显示 "0ms" 会让人以为没执行，
 * 所以 sub-ms 时给个 "<1ms" 的写法。
 */
function formatElapsed(ms) {
  const n = Number(ms) || 0
  if (n <= 0) return '<1ms'
  if (n < 1000) return `${n}ms`
  return `${(n / 1000).toFixed(1)}s`
}

// ---------------------------------------------------------------- 生命周期
onMounted(() => {
  if (props.open) {
    refreshHealth()
    startHealthPolling()
  }
})

watch(() => props.open, (open) => {
  if (open) {
    refreshHealth()
    startHealthPolling()
  } else {
    stopHealthPolling()
  }
})

onBeforeUnmount(stopHealthPolling)

// Esc 关闭面板（App.vue 已在全局处理 Settings 的 Esc，这里单独兜一层）
function onEsc(event) {
  if (event.key !== 'Escape') return
  if (!props.open) return
  event.stopPropagation()
  emit('close')
}
onMounted(() => window.addEventListener('keydown', onEsc, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc, true))
</script>

<template>
  <Teleport to="body">
    <Transition name="ad-modal">
      <div v-if="open" class="ad-layer" @mousedown.self="emit('close')">
        <section class="ad-panel" role="dialog" aria-modal="true" aria-label="AdShield 激活码控制台">
          <!-- ===== 头部 ===== -->
          <header class="panel-head">
            <div class="head-title">
              <span class="head-icon"><AppIcon name="key" :size="18" /></span>
              <div>
                <h2>AdShield 激活码</h2>
                <p>设备授权码生成器</p>
              </div>
            </div>
            <button type="button" class="dialog-close" title="关闭（Esc）" aria-label="关闭控制台" @click="emit('close')">
              <AppIcon name="x" :size="18" />
            </button>
          </header>

          <div class="panel-body">
            <!-- ===== 状态灯 ===== -->
            <button
              type="button"
              class="health-bar"
              :class="`is-${healthState}`"
              :title="healthMessage"
              @click="refreshHealth"
            >
              <span class="dot" :class="healthDotClass">
                <span v-if="healthState === 'checking'" class="dot-pulse"></span>
              </span>
              <span class="health-text">{{ healthLabel }}</span>
              <span v-if="healthState !== 'alive'" class="health-hint">{{ healthMessage }}</span>
              <span class="health-refresh" :class="{ spinning: checking }">
                <AppIcon name="refresh" :size="12" />
              </span>
            </button>

            <!-- 插件缺失时给一条明确的补救指引，而不是让用户干瞪眼 -->
            <div v-if="healthState === 'down'" class="install-tip">
              <AppIcon name="alert" :size="13" />
              <span>
                请把 <code>adshield_exe</code> 整个目录（含 <code>AdShield.exe</code> 与
                <code>_internal</code>）放到应用数据目录的 <code>plugins/</code> 下，
                或用打包命令重新生成。详见项目内 <code>README-adshield.md</code>。
              </span>
            </div>
            <div v-else-if="healthState === 'degraded'" class="install-tip is-warn">
              <AppIcon name="alert" :size="13" />
              <span>插件文件存在但内容为空，通常是被中断的复制或下载。请重新放置一份完整的 exe。</span>
            </div>

            <!-- ===== 输入区 ===== -->
            <section class="block">
              <div class="block-head">
                <h3><AppIcon name="cpu" :size="14" /> 设备信息</h3>
                <span v-if="keyword.trim()" class="len-badge">{{ keyword.trim().length }}</span>
              </div>

              <div class="input-wrap">
                <input
                  v-model="keyword"
                  class="input ad-input"
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  placeholder="8位设备ID，如需续费可加英文逗号和时间戳"
                  :disabled="loading"
                  @keydown="onKeydown"
                />
                <button
                  v-if="keyword"
                  type="button"
                  class="clear-btn"
                  title="清空"
                  @click="keyword = ''"
                >
                  <AppIcon name="x" :size="12" />
                </button>
              </div>

              <p class="hint">
                示例：<code>ABCD1234</code> 或续费格式 <code>ABCD1234,1730000000</code>
              </p>

              <div class="actions">
                <button
                  type="button"
                  class="btn btn-primary gen-btn"
                  :disabled="!canSubmit"
                  @click="onSubmit"
                >
                  <span v-if="loading" class="spinner"></span>
                  <AppIcon v-else name="zap" :size="15" />
                  {{ loading ? '生成中…' : '生成激活码' }}
                </button>
                <button
                  v-if="keyword || resultText || errorText"
                  type="button"
                  class="btn btn-sm ghost-btn"
                  :disabled="loading"
                  @click="clearAll"
                >
                  清空
                </button>
              </div>
            </section>

            <!-- ===== 错误提示 ===== -->
            <Transition name="fade">
              <div v-if="errorText" class="error-box" role="alert">
                <AppIcon name="alert" :size="14" />
                <span>{{ errorText }}</span>
              </div>
            </Transition>

            <!-- ===== 结果展示 ===== -->
            <Transition name="fade">
              <section v-if="resultText" class="block result-block">
                <div class="block-head">
                  <h3><AppIcon name="braces" :size="14" /> 生成结果</h3>
                  <div class="result-tools">
                    <span v-if="resultMeta" class="elapsed">{{ formatElapsed(resultMeta.elapsedMs) }}</span>
                    <button
                      type="button"
                      class="copy-btn"
                      :class="{ 'is-copied': copied }"
                      @click="copyResult"
                    >
                      <AppIcon :name="copied ? 'check' : 'copy'" :size="13" />
                      {{ copied ? '已复制' : '复制' }}
                    </button>
                  </div>
                </div>

                <!-- 深色代码框 -->
                <div class="code-box">
                  <div class="code-topbar">
                    <span class="code-dots"><i></i><i></i><i></i></span>
                    <span class="code-lang">activation-code</span>
                  </div>
                  <pre class="code-body"><code>{{ resultText }}</code></pre>
                  <div class="code-glow" aria-hidden="true"></div>
                </div>

                <p v-if="resultMeta?.truncated" class="hint is-warn">
                  <AppIcon name="alert" :size="12" /> 结果过长已截断，完整内容请调整插件输出
                </p>
                <p v-if="resultMeta?.keyword" class="hint">
                  请求参数：<code>{{ resultMeta.keyword }}</code>
                </p>
              </section>
            </Transition>

            <!-- ===== 空状态 ===== -->
            <div v-if="!resultText && !errorText" class="empty-state">
              <span class="empty-icon"><AppIcon name="shield" :size="30" /></span>
              <p class="empty-title">等待生成</p>
              <p class="empty-sub">输入设备 ID 后点击「生成激活码」</p>
            </div>
          </div>

          <footer class="panel-foot">
            <span class="foot-note" :title="pluginInfo?.path || '插件未找到'">
              <span class="foot-dot" :class="{ 'is-off': healthState === 'down' }"></span>
              <template v-if="pluginInfo?.found">
                本地插件 {{ pluginInfo.name }} · {{ pluginInfo.size_human }}
                <template v-if="pluginInfo.layout === 'onedir'"> · 目录版</template>
              </template>
              <template v-else>插件未安装</template>
            </span>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ================= 层与弹窗 =================
   z-index 层级约定（改这里前务必同步检查）：
     Sidebar 抽屉       100（小屏）
     SettingsPanel       80
     AdShield modal     120  ← 本组件，必须盖住设置面板
     ConfirmDialog      .confirm-layer 见组件内
     Toast              最高
   ============================================ */
.ad-layer {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
}

.ad-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: min(86vh, 760px);
  background: var(--panel-bg);
  border: 1px solid var(--glass-border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-2), 0 0 0 1px rgba(139, 92, 246, 0.12);
  overflow: hidden;
}

/* 顶部渐变描边，和 chat-panel 的设计语言保持一致 */
.ad-panel::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(139, 92, 246, 0.6), rgba(34, 211, 238, 0.5), transparent);
  pointer-events: none;
}

/* ================= 头部 ================= */
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 18px 14px;
  flex: none;
  border-bottom: 1px solid var(--glass-border);
}
.head-title { display: flex; align-items: center; gap: 11px; }
.head-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  color: var(--accent-1);
  background: var(--accent-grad-soft);
  border: 1px solid var(--glass-border);
}
.panel-head h2 { font-size: 16px; color: var(--text-strong); }
.panel-head p { margin-top: 1px; font-size: 11.5px; color: var(--muted); }

.panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 8px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ================= 状态灯 ================= */
.health-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border-radius: 12px;
  font-size: 12px;
  text-align: left;
  color: var(--muted);
  background: var(--glass);
  border: 1px solid var(--glass-border);
  transition: border-color 0.2s, background 0.2s;
}
.health-bar:hover { background: var(--glass-hover); }
.health-bar.is-alive { border-color: rgba(52, 211, 153, 0.32); background: rgba(52, 211, 153, 0.07); }
.health-bar.is-down { border-color: rgba(251, 113, 133, 0.32); background: rgba(251, 113, 133, 0.07); }
.health-bar.is-degraded { border-color: rgba(251, 191, 36, 0.32); background: rgba(251, 191, 36, 0.07); }

/* 呼吸点 */
.dot {
  position: relative;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: var(--faint);
  transition: background 0.25s, box-shadow 0.25s;
}
.dot.is-alive {
  background: #34d399;
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.16), 0 0 10px rgba(52, 211, 153, 0.7);
  animation: breathe 2.4s ease-in-out infinite;
}
.dot.is-down {
  background: #fb7185;
  box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.16), 0 0 10px rgba(251, 113, 133, 0.65);
  animation: breathe 1.4s ease-in-out infinite;
}
.dot.is-degraded {
  background: #fbbf24;
  box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.16), 0 0 10px rgba(251, 191, 36, 0.6);
  animation: breathe 1.8s ease-in-out infinite;
}
.dot.is-checking { background: var(--faint); }
.dot-pulse {
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1px solid currentColor;
  opacity: 0.5;
  animation: ripple 1.4s ease-out infinite;
}

@keyframes breathe {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.62; transform: scale(0.86); }
}
@keyframes ripple {
  0% { transform: scale(0.7); opacity: 0.6; }
  100% { transform: scale(2); opacity: 0; }
}

.health-text { font-weight: 600; color: var(--text); flex: none; }
.health-hint {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.health-refresh { margin-left: auto; color: var(--faint); display: grid; place-items: center; flex: none; }
.health-refresh.spinning { animation: spin 0.9s linear infinite; }

/* 插件缺失/损坏时的操作指引 */
.install-tip {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--muted);
  background: rgba(251, 113, 133, 0.08);
  border: 1px solid rgba(251, 113, 133, 0.22);
}
.install-tip.is-warn {
  background: rgba(251, 191, 36, 0.08);
  border-color: rgba(251, 191, 36, 0.22);
}
.install-tip :deep(svg) { flex: none; margin-top: 1px; color: #fb7185; }
.install-tip.is-warn :deep(svg) { color: #fbbf24; }
.install-tip code {
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 1px 5px;
  border-radius: 5px;
  color: var(--code-inline-text);
  background: var(--code-inline-bg);
}

/* ================= 区块 ================= */
.block {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 14px;
  border-radius: 16px;
  background: var(--glass);
  border: 1px solid var(--glass-border);
}
.block-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.block-head h3 {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 620;
  color: var(--text-strong);
}
.block-head h3 :deep(svg) { color: var(--accent-1); }
.len-badge {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 999px;
  color: var(--muted);
  background: var(--glass-hover);
  border: 1px solid var(--glass-border);
}

/* ================= 输入 ================= */
.input-wrap { position: relative; }
.ad-input {
  padding-right: 34px;
  font-family: var(--font-mono);
  letter-spacing: 0.02em;
  text-transform: none;
}
.clear-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: var(--faint);
  background: var(--glass-hover);
  transition: color 0.16s, background 0.16s;
}
.clear-btn:hover { color: var(--text-strong); background: var(--glass-active); }

.hint { font-size: 11px; color: var(--faint); line-height: 1.5; }
.hint code {
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 1px 5px;
  border-radius: 5px;
  color: var(--code-inline-text);
  background: var(--code-inline-bg);
  /* 续费格式的长示例在窄面板里可能撑破，允许换行 */
  white-space: pre-wrap;
  word-break: break-all;
}
.hint.is-warn { display: inline-flex; align-items: center; gap: 5px; color: #fbbf24; }

/* ================= 按钮 ================= */
.actions { display: flex; gap: 8px; }
.gen-btn { flex: 1; min-width: 0; white-space: nowrap; }
.ghost-btn {
  flex: none;
  padding: 0 14px;
  white-space: nowrap;
  background: transparent;
  border-color: var(--glass-border);
  color: var(--muted);
}
.ghost-btn:hover { color: var(--text); background: var(--glass-hover); }

.spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.32);
  border-top-color: #fff;
  animation: spin 0.7s linear infinite;
  flex: none;
}

/* ================= 错误 ================= */
.error-box {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.5;
  color: #fecdd3;
  background: rgba(251, 113, 133, 0.1);
  border: 1px solid rgba(251, 113, 133, 0.28);
}
.error-box :deep(svg) { color: #fb7185; flex: none; margin-top: 1px; }

/* ================= 结果 ================= */
.result-block { border-color: rgba(139, 92, 246, 0.22); }
.result-tools { display: flex; align-items: center; gap: 8px; }
.elapsed { font-family: var(--font-mono); font-size: 10px; color: var(--faint); }

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 560;
  color: var(--muted);
  background: var(--glass);
  border: 1px solid var(--glass-border);
  transition: color 0.18s, background 0.18s, border-color 0.18s;
}
.copy-btn:hover { color: var(--text-strong); background: var(--glass-hover); border-color: var(--glass-border-strong); }
.copy-btn.is-copied {
  color: #34d399;
  background: rgba(52, 211, 153, 0.1);
  border-color: rgba(52, 211, 153, 0.32);
}

/* ================= 深色代码框 ================= */
.code-box {
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  background: #080a13;
  border: 1px solid rgba(139, 92, 246, 0.24);
  box-shadow: 0 18px 44px -22px rgba(124, 92, 245, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

/* 顶部渐变描边 */
.code-box::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(139, 92, 246, 0.85), rgba(34, 211, 238, 0.7), transparent);
  pointer-events: none;
  z-index: 2;
}

.code-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.035);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.code-dots { display: inline-flex; gap: 5px; }
.code-dots i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
}
.code-dots i:nth-child(1) { background: rgba(251, 113, 133, 0.55); }
.code-dots i:nth-child(2) { background: rgba(251, 191, 36, 0.55); }
.code-dots i:nth-child(3) { background: rgba(52, 211, 153, 0.55); }
.code-lang {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.42);
}

.code-body {
  position: relative;
  z-index: 1;
  margin: 0;
  padding: 14px 16px;
  max-height: 220px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.7;
  color: #a5f3fc;
  white-space: pre-wrap;
  word-break: break-all;
  text-shadow: 0 0 18px rgba(34, 211, 238, 0.28);
}
.code-body code { font-family: inherit; }

/* 底部氛围光 */
.code-glow {
  position: absolute;
  left: -20%;
  right: -20%;
  bottom: -70%;
  height: 140px;
  background: radial-gradient(ellipse at center, rgba(139, 92, 246, 0.3) 0%, transparent 70%);
  pointer-events: none;
}

/* 代码框滚动条 */
.code-body::-webkit-scrollbar { width: 5px; height: 5px; }
.code-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 3px;
}
.code-body::-webkit-scrollbar-track { background: transparent; }

/* ================= 空状态 ================= */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 34px 20px;
  border-radius: 16px;
  border: 1px dashed var(--glass-border);
  background: transparent;
}
.empty-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: 4px;
  border-radius: 18px;
  color: var(--accent-2);
  background: var(--accent-grad-soft);
  border: 1px solid var(--glass-border);
  box-shadow: 0 10px 30px -16px rgba(34, 211, 238, 0.7);
}
.empty-title { font-size: 13px; font-weight: 600; color: var(--text); }
.empty-sub { font-size: 11.5px; color: var(--faint); }

/* ================= 底部 ================= */
/* 弹窗不再贴屏幕底边，safe-area 由外层 .ad-layer 的 padding 处理 */
.panel-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 11px 18px 13px;
  flex: none;
  border-top: 1px solid var(--glass-border);
  background: var(--glass);
}
.foot-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  color: var(--faint);
}
.foot-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent-2);
  box-shadow: 0 0 8px rgba(34, 211, 238, 0.8);
}
.foot-dot.is-off {
  background: #fb7185;
  box-shadow: 0 0 8px rgba(251, 113, 133, 0.8);
}

/* ================= 过渡与动画 ================= */
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.fade-enter-active, .fade-leave-active { transition: opacity 0.22s var(--ease); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* 居中弹窗的进出：遮罩淡入 + 面板轻微缩放上浮 */
.ad-modal-enter-active, .ad-modal-leave-active { transition: opacity 0.2s var(--ease); }
.ad-modal-enter-from, .ad-modal-leave-to { opacity: 0; }
.ad-modal-enter-active .ad-panel, .ad-modal-leave-active .ad-panel {
  transition: transform 0.24s var(--ease-spring), opacity 0.2s var(--ease);
}
.ad-modal-enter-from .ad-panel, .ad-modal-leave-to .ad-panel {
  transform: translateY(10px) scale(0.97);
  opacity: 0;
}

/* 小屏：让弹窗接近全屏，但保留一点边距能看出是浮层 */
@media (max-width: 560px) {
  .ad-layer { padding: 12px; }
  .ad-panel { width: 100%; max-height: 92vh; border-radius: var(--radius-md); }
}

/* 尊重「减少动效」偏好 */
@media (prefers-reduced-motion: reduce) {
  .ad-modal-enter-active .ad-panel, .ad-modal-leave-active .ad-panel { transition: none; }
  .ad-modal-enter-from .ad-panel, .ad-modal-leave-to .ad-panel { transform: none; }
}
</style>
