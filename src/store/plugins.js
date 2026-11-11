import { ref } from 'vue'
import { toast } from './toast'

export const plugins = ref([])
export const loading = ref(false)

export async function fetchPlugins() {
  loading.value = true
  try {
    const res = await fetch('/api/plugins')
    if (res.ok) {
      const data = await res.json()
      plugins.value = data.plugins || []
      
      if (data.errors && data.errors.length > 0) {
        toast.error(`插件加载失败: ${data.errors[0]}`)
      }
    }
  } catch (err) {
    console.error('拉取插件列表失败:', err)
  } finally {
    loading.value = false
  }
}

export async function uploadPlugin(files) {
  const formData = new FormData()
  const paths = []
  
  files.forEach(file => {
    formData.append('files', file)
    paths.push(file.webkitRelativePath || file.name)
  })
  
  formData.append('pathsJson', JSON.stringify(paths))
  
  const res = await fetch('/api/plugins/upload-multi', {
    method: 'POST',
    body: formData
  })
  
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '上传失败')
  
  await fetchPlugins()
  return true
}

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

// 👈 新增：重命名插件
export async function renamePlugin(id, alias) {
  try {
    await fetch(`/api/plugins/${id}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias })
    })
    const p = plugins.value.find(x => x.id === id)
    if (p) p.alias = alias
  } catch (err) {
    console.error('重命名插件失败:', err)
    throw err
  }
}

export async function removePlugin(id) {
  try {
    const res = await fetch(`/api/plugins/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('删除失败')
    plugins.value = plugins.value.filter(x => x.id !== id)
  } catch (err) {
    console.error('删除插件失败:', err)
    throw err
  }
}