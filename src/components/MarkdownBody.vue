<script setup>
import { computed } from 'vue'
import { copyText } from '../utils/format'
import { renderMarkdown } from '../utils/markdown'
import { toast } from '../store/toast'

const props = defineProps({
  source: { type: String, default: '' },
})

const html = computed(() => renderMarkdown(props.source))

async function onClick(event) {
  const button = event.target.closest?.('.code-copy')
  if (!button) return

  const card = button.closest('.code-card')
  const code = card?.querySelector('.code-pre code')?.textContent ?? ''
  if (!code) return

  const ok = await copyText(code)
  if (!ok) {
    toast.error('复制失败，请手动选中代码')
    return
  }
  button.textContent = '已复制'
  button.classList.add('is-done')
  setTimeout(() => {
    button.textContent = '复制'
    button.classList.remove('is-done')
  }, 1600)
}
</script>

<template>
  <div class="md-body" v-html="html" @click="onClick"></div>
</template>
