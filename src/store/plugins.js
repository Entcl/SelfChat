import { ref } from 'vue'

export const plugins = ref([])
export const loading = ref(false)

// 1. 获取/刷新插件列表
export async function fetchPlugins() {
  loading.value = true
  try {
    const res = await fetch('/api/plugins')
    if (res.ok) {
      plugins.value = await res.json()
    }
  } catch (err) {
    console.error('拉取插件列表失败:', err)
  } finally {
    loading.value = false
  }
}

// 2. 上传插件
export async function uploadPlugin(file) {
  const formData = new FormData()
  formData.append('plugin', file)
  
  const res = await fetch('/api/plugins/upload', {
    method: 'POST',
    body: formData
  })
  if (!res.ok) throw new Error('上传失败')
  
  // 上传成功后，重新拉取一次列表
  await fetchPlugins()
  return true
}

// 3. 开启/关闭插件
export async function togglePlugin(id, enabled) {
  try {
    await fetch(`/api/plugins/${id}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    })
    const p = plugins.value.find(x => x.id === id)
    if (p) p.enabled = enabled
  } catch (err) {
    console.error('切换插件状态失败:', err)
    throw err
  }
}