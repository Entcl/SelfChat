import { ref } from 'vue'
import { loadJSON, saveJSON } from '../utils/storage'

const STORAGE_KEY = 'sc.user.profile.v1'

export const userAvatar = ref('')
export const aiAvatar = ref('')
export const aiName = ref('大肥鱼')

export async function initUserStore() {
  const saved = await loadJSON(STORAGE_KEY, {})
  if (saved.userAvatar) userAvatar.value = saved.userAvatar
  if (saved.aiAvatar) aiAvatar.value = saved.aiAvatar
  if (saved.aiName) aiName.value = saved.aiName
}

async function persist() {
  await saveJSON(STORAGE_KEY, {
    userAvatar: userAvatar.value,
    aiAvatar: aiAvatar.value,
    aiName: aiName.value
  })
}

export async function setUserAvatar(val) {
  userAvatar.value = val
  await persist()
}

export async function setAiAvatar(val) {
  aiAvatar.value = val
  await persist()
}

export async function setAiName(val) {
  aiName.value = val.trim() || '大肥鱼'
  await persist()
}