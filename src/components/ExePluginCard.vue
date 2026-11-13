<script setup>
/**
 * ExePluginCard —— EXE 插件卡片
 * ============================================================
 * 展示一个编译好的独立可执行插件（如 AdShield.exe）：
 *   - 左侧状态点（绿=就绪 / 黄=损坏 / 红=找不到）
 *   - 名称 + .exe 角标 + 大小 + 打包方式
 *   - 右侧启用开关
 *   - 底部「打开控制台」按钮
 *
 * 数据来自 GET /api/plugins/exe（server/routes/exe-plugins.js）。
 * ============================================================
 */
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  plugin: { type: Object, required: true },
  /** 健康状态：'checking' | 'alive' | 'degraded' | 'down' */
  health: { type: String, default: 'checking' },
  /** 是否正在切换启用状态 */
  toggling: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle', 'open'])

const dotClass = computed(() => `is-${props.health}`)

const statusText = computed(() => {
  if (props.health === 'alive') return '已就绪'
  if (props.health === 'degraded') return '文件损坏'
  if (props.health === 'down') return '未找到'
  return '检测中'
})

/** 未启用时不允许打开控制台，避免用户以为「点了没反应」 */
const canOpen = computed(() => props.plugin.enabled && props.health !== 'down')

function onOpen() {
  if (!canOpen.value) return
  emit('open', props.plugin)
}
</script>

<template>
  <div class="exe-card" :class="{ 'is-disabled': !plugin.enabled }">
    <!-- 右上角 EXE 角标：与普通插件做视觉区分 -->
    <span class="exe-badge">.exe</span>

    <div class="exe-main">
      <div class="exe-icon">
        <AppIcon name="zap" :size="20" />
      </div>

      <div class="exe-info">
        <div class="exe-title-row">
          <span class="exe-dot" :class="dotClass"></span>
          <span class="exe-name" :title="plugin.exePath || plugin.name">
            {{ plugin.displayName || plugin.name }}
          </span>
          <span class="exe-meta">{{ plugin.sizeHuman }}</span>
        </div>

        <p class="exe-desc">
          {{ plugin.desc }}
          <span class="exe-layout">{{ plugin.layout === 'onedir' ? '目录版' : '单文件' }}</span>
        </p>
      </div>
    </div>

    <!-- 底部：左侧状态 + 开关，右侧打开按钮。
         开关原先在右上角，会和 .exe 角标抢位置，所以挪到这里。 -->
    <div class="exe-footer">
      <div class="exe-footer-left">
        <span class="exe-status" :class="`is-${health}`">{{ statusText }}</span>
        <span v-if="!plugin.enabled" class="exe-hint">已禁用</span>
        <label class="exe-switch" :title="plugin.enabled ? '点击禁用' : '点击启用'">
          <input
            type="checkbox"
            :checked="plugin.enabled"
            :disabled="toggling"
            @change="emit('toggle', { plugin, enabled: $event.target.checked })"
          />
          <span class="exe-slider"></span>
        </label>
      </div>

      <button
        type="button"
        class="btn btn-sm exe-open-btn"
        :disabled="!canOpen"
        :title="canOpen ? '打开操作控制台' : (plugin.enabled ? '插件不可用' : '请先启用插件')"
        @click="onOpen"
      >
        <AppIcon name="braces" :size="13" />
        打开控制台
      </button>
    </div>
  </div>
</template>

<style scoped>
.exe-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 16px;
  background: var(--glass);
  border: 1px solid var(--glass-border);
  transition: border-color 0.2s var(--ease), background 0.2s var(--ease);
}
.exe-card:hover {
  border-color: rgba(139, 92, 246, 0.32);
  background: var(--glass-hover);
}
/* 禁用态整体降低存在感，但不隐藏（用户仍需要打开开关） */
.exe-card.is-disabled { opacity: 0.62; }

/* 右上角 .exe 角标 */
.exe-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 1px 6px;
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #c4b5fd;
  background: rgba(139, 92, 246, 0.16);
  border: 1px solid rgba(139, 92, 246, 0.34);
  pointer-events: none;
}

.exe-main { display: flex; align-items: flex-start; gap: 11px; }

.exe-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 12px;
  color: var(--accent-1);
  background: var(--accent-grad-soft);
  border: 1px solid var(--glass-border);
}

.exe-info { flex: 1; min-width: 0; padding-right: 48px; /* 给右上角 .exe 角标让位 */ }

.exe-title-row { display: flex; align-items: center; gap: 7px; min-width: 0; }
.exe-dot {
  width: 7px; height: 7px; flex: none; border-radius: 50%;
  background: var(--faint);
  transition: background 0.25s, box-shadow 0.25s;
}
.exe-dot.is-alive {
  background: #34d399;
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.14), 0 0 8px rgba(52, 211, 153, 0.6);
}
.exe-dot.is-degraded {
  background: #fbbf24;
  box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.14), 0 0 8px rgba(251, 191, 36, 0.55);
}
.exe-dot.is-down {
  background: #fb7185;
  box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.14), 0 0 8px rgba(251, 113, 133, 0.55);
}

.exe-name {
  font-size: 13.5px;
  font-weight: 620;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.exe-meta {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--faint);
  flex: none;
}

.exe-desc {
  margin-top: 5px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--muted);
}
.exe-layout {
  display: inline-block;
  margin-left: 5px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  color: var(--faint);
  background: var(--glass-hover);
  border: 1px solid var(--glass-border);
}

.exe-status-line { display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
.exe-status {
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  color: var(--faint);
  background: var(--glass-hover);
  border: 1px solid var(--glass-border);
}
.exe-status.is-alive { color: #34d399; background: rgba(52, 211, 153, 0.1); border-color: rgba(52, 211, 153, 0.26); }
.exe-status.is-degraded { color: #fbbf24; background: rgba(251, 191, 36, 0.1); border-color: rgba(251, 191, 36, 0.26); }
.exe-status.is-down { color: #fb7185; background: rgba(251, 113, 133, 0.1); border-color: rgba(251, 113, 133, 0.26); }
.exe-hint { font-size: 10.5px; color: var(--faint); }

/* 开关（与 SettingsPanel 里普通插件的样式保持一致） */
.exe-switch { position: relative; display: inline-block; width: 36px; height: 20px; flex: none; }
.exe-switch input { opacity: 0; width: 0; height: 0; }
.exe-slider {
  position: absolute; cursor: pointer; inset: 0;
  background: var(--glass-active);
  border-radius: 20px;
  transition: background 0.28s var(--ease);
}
.exe-slider::before {
  content: '';
  position: absolute;
  height: 16px; width: 16px; left: 2px; bottom: 2px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.28s var(--ease);
}
.exe-switch input:checked + .exe-slider { background: #34d399; }
.exe-switch input:checked + .exe-slider::before { transform: translateX(16px); }
.exe-switch input:disabled + .exe-slider { opacity: 0.5; cursor: not-allowed; }

.exe-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--glass-border);
}
.exe-footer-left { display: flex; align-items: center; gap: 9px; min-width: 0; }
.exe-open-btn { height: 30px; font-size: 12px; padding: 0 12px; border-radius: 9px; flex: none; }
</style>
