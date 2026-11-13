<script setup>
/**
 * 统一的 AI 头像组件。
 *
 * 三个地方共用它，确保「换头像后三处同时刷新」：
 *   a. 左上角主头像      <AiAvatar size="header" editable />
 *   b. 左侧会话列表      <AiAvatar size="sidebar" resettable />
 *   c. 聊天气泡旁的头像   <AiAvatar size="bubble" />
 *
 * 关键约束：本组件**不持有任何名字/头像 state**，全部从 store/user 读。
 * 换头像时调用 updateAvatar(provider, dataUrl)，靠 Vue 响应式让三处同步。
 *
 * 右键拦截由模板上的 `@contextmenu.prevent` 无条件完成（修饰符先于业务函数执行），
 * 业务函数里的任何 return 都影响不到它 —— 这一点很关键：
 * 曾经把 preventDefault 写在函数体里、且前面挡了个 if (!editable) return，
 * 结果侧边栏头像右键照样弹出浏览器原生菜单。
 */
import { computed, ref } from 'vue'
import { aiAvatar, currentProviderType, updateAvatar } from '../store/user'
import { toast } from '../store/toast'
import { fileToAvatarDataUrl, AvatarError } from '../utils/image'
import trumpIcon from '../assets/trumpIcon.svg'

const props = defineProps({
  /** 尺寸档位，对应不同位置的样式 */
  size: { type: String, default: 'bubble' }, // header | sidebar | bubble
  /** 是否允许点击换头像（左键选图） */
  editable: { type: Boolean, default: false },
  /**
   * 是否允许右键恢复默认头像。
   * 不传（undefined）时跟随 editable；显式传 true/false 可覆盖，
   * 让侧边栏那种「只展示、不给点」的位置也能单独开启右键重置。
   */
  resettable: { type: Boolean, default: undefined },
  /** 自定义类名，便于各页面微调 */
  imgClass: { type: String, default: '' },
})

const fileInput = ref(null)
const busy = ref(false)

const src = computed(() => aiAvatar.value || trumpIcon)

/** 左键换图能力：只看 editable */
const canPick = computed(() => props.editable)

/** 右键重置能力：显式传入优先，否则跟随 editable */
const canReset = computed(() =>
  props.resettable === undefined ? props.editable : props.resettable,
)

const tooltip = computed(() => {
  if (canPick.value && canReset.value) return '点击更换头像，右键恢复默认'
  if (canPick.value) return '点击更换头像'
  if (canReset.value) return '右键恢复默认头像'
  return ''
})

function onClick() {
  if (!canPick.value || busy.value) return
  fileInput.value?.click()
}

async function onFileChange(event) {
  const file = event.target.files?.[0]
  // 立刻清空，否则连续选同一张图不会触发 change
  event.target.value = ''
  if (!file) return

  busy.value = true
  try {
    // 在这里就把图压到 128x128 JPEG，绝不把原图 Base64 塞进 store
    const { dataUrl } = await fileToAvatarDataUrl(file)
    // 显式带上 provider：即使处理期间用户切了会话，也写回发起时的那一侧
    updateAvatar(currentProviderType.value, dataUrl)
    toast.success('头像已更新')
  } catch (err) {
    const msg = err instanceof AvatarError ? err.message : '头像处理失败，请换一张试试'
    toast.error(msg)
  } finally {
    busy.value = false
  }
}

/** 右键：恢复内置默认头像。
 *
 * 注意：阻止默认菜单这件事由模板上的 `@contextmenu.prevent` 无条件完成，
 * 绝不能依赖本函数 —— 一旦这里有任何提前 return（比如「不可编辑就不管」），
 * preventDefault 就会被跳过，浏览器原生菜单又会弹出来。
 * 这个函数只负责「重置 + 提示」这一业务动作。
 */
function onContextMenu() {
  if (!canReset.value) return
  // 即使本来就是默认图也照样清一次并给提示：
  // 右键后毫无反应会让用户以为功能坏了。
  updateAvatar(currentProviderType.value, '')
  toast.success('已恢复默认头像')
}
</script>

<template>
  <span
    class="ai-avatar"
    :class="[`ai-avatar--${size}`, { 'is-editable': canPick, 'is-resettable': canReset, 'is-busy': busy }]"
    :title="tooltip"
    @click="onClick"
    @contextmenu.prevent="onContextMenu"
  >
    <!-- img 上也挂一份 .prevent：右键落在图片本身时同样兜住，
         避免个别 Chromium 版本对 img 的原生菜单行为差异 -->
    <img
      :src="src"
      :class="imgClass"
      alt="AI 头像"
      draggable="false"
      @contextmenu.prevent
    />
    <span v-if="busy" class="ai-avatar-spinner" aria-hidden="true"></span>

    <input
      v-if="canPick"
      ref="fileInput"
      type="file"
      accept="image/png, image/jpeg"
      class="ai-avatar-input"
      @change="onFileChange"
    />
  </span>
</template>

<style scoped>
.ai-avatar {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  flex: none;
  background: var(--accent-grad);
  color: #fff;
  font-weight: 700;
  box-shadow: var(--shadow-glow);
  border: 1px solid rgba(255, 255, 255, 0.18);
  user-select: none;
  transition: transform 0.18s var(--ease, ease), filter 0.18s var(--ease, ease);
}

.ai-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* 三档尺寸，与各页面原有的圆角/尺寸保持一致 */
.ai-avatar--header {
  width: 38px;
  height: 38px;
  border-radius: 13px;
  font-size: 17px;
}

.ai-avatar--sidebar {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  font-size: 18px;
}

.ai-avatar--bubble {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  font-size: 12.5px;
  box-shadow: var(--shadow-1);
  border-color: var(--glass-border);
  /* 与气泡内用户名那一行对齐；原 .avatar 靠这个 margin 顶下来的 */
  margin-top: 22px;
}

/* 侧边栏会话列表行内的小头像，尺寸与 .session-icon 的占位感对齐 */
.ai-avatar--session {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  font-size: 10px;
  box-shadow: none;
  border-color: var(--glass-border);
}

/* 设置面板里的预览档，对应原 .avatar-preview 的 52px */
.ai-avatar--settings {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  font-size: 20px;
  box-shadow: var(--shadow-1);
  border-color: var(--glass-border);
}

/* 只有可编辑的那一处才给手型和 hover 反馈 */
.ai-avatar.is-editable {
  cursor: pointer;
}

/* 不可左键更换、但支持右键重置时，用 context-menu 光标暗示 */
.ai-avatar.is-resettable:not(.is-editable) {
  cursor: context-menu;
}

.ai-avatar.is-editable:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.ai-avatar.is-editable:active {
  transform: translateY(0) scale(0.97);
}

.ai-avatar.is-editable:focus-visible {
  outline: 2px solid var(--accent-2);
  outline-offset: 2px;
}

.ai-avatar.is-busy {
  cursor: progress;
}

.ai-avatar-spinner {
  position: absolute;
  inset: 0;
  display: block;
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(1px);
}

.ai-avatar-spinner::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ai-avatar-spin 0.7s linear infinite;
}

@keyframes ai-avatar-spin {
  to {
    transform: rotate(360deg);
  }
}

.ai-avatar-input {
  display: none;
}

@media (max-width: 720px) {
  .ai-avatar--header {
    width: 34px;
    height: 34px;
    border-radius: 11px;
    font-size: 17px;
  }

  .ai-avatar--bubble {
    width: 30px;
    height: 30px;
    border-radius: 10px;
    font-size: 11.5px;
    margin-top: 20px;
  }
}
</style>
