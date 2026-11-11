import { reactive } from 'vue'

export const toasts = reactive([])

let seq = 0

export function toast(message, type = 'info', duration = 2400) {
  const id = ++seq
  toasts.push({ id, message, type })
  setTimeout(() => {
    const index = toasts.findIndex((item) => item.id === id)
    if (index > -1) toasts.splice(index, 1)
  }, duration)
  return id
}

toast.success = (message, duration) => toast(message, 'success', duration)
toast.error = (message, duration) => toast(message, 'error', duration)
toast.info = (message, duration) => toast(message, 'info', duration)
