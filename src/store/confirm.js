import { reactive } from 'vue'

export const confirmState = reactive({
  open: false,
  title: '',
  message: '',
  confirmText: '确认',
  danger: true,
  resolve: null,
})

export function askConfirm({ title, message = '', confirmText = '确认', danger = true }) {
  return new Promise((resolve) => {
    confirmState.resolve?.(false)
    Object.assign(confirmState, { open: true, title, message, confirmText, danger, resolve })
  })
}

export function settleConfirm(value) {
  const resolve = confirmState.resolve
  confirmState.open = false
  confirmState.resolve = null
  resolve?.(value)
}
