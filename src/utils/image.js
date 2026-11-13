/**
 * 头像图片处理：读文件 → 居中裁方 → 缩放 → 压缩成 JPEG DataURL。
 *
 * 为什么必须做这件事：
 * 用户随手选的一张手机照片可能就是 4~8MB，转成 Base64 还要再涨 33%。
 * 之前 SettingsPanel / MessageBubble 里都是 readAsDataURL 直接把原图塞进
 * profile blob，实测把 `w1::sc.user.profile.v1` 撑到了 2.2MB，
 * 而这个 blob 每次改名都要整体写一遍 SQLite —— 界面会明显卡顿。
 *
 * 这里统一压到 128x128 JPEG(q=0.8)，单张稳定在 3~8KB，彻底消除这个隐患。
 */

/** 头像最终边长（px）。128 足够 2x 屏上 38px 头像清晰显示 */
export const AVATAR_SIZE = 128

/** JPEG 质量。0.8 是体积/画质的拐点，再高体积涨得很快而肉眼几乎无差别 */
export const AVATAR_QUALITY = 0.8

/** 允许的输入类型 */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** 输入文件体积上限，超过直接拒绝（避免在解码阶段就吃掉大量内存） */
const MAX_INPUT_BYTES = 10 * 1024 * 1024

export class AvatarError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AvatarError'
  }
}

/**
 * 用 createImageBitmap 解码。相比 <img> + object URL，它能显式 close() 释放位图，
 * 对「用户连续点了几次换头像」这种场景更稳。
 *
 * Safari 早期版本没有 createImageBitmap，回退到 <img> 方案。
 */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // imageOrientation: 'from-image' 让手机竖拍照片按 EXIF 方向正确显示，
      // 否则竖图会被压成横的。
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch {
      // 某些格式/环境不支持该选项，落到下面的 <img> 回退
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new AvatarError('图片解码失败，请换一张试试'))
      el.src = url
    })
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

/**
 * 把任意图片文件处理成正方形头像 DataURL。
 *
 * @param {File} file 用户选择的文件
 * @param {{ size?: number, quality?: number }} [opts]
 * @returns {Promise<{ dataUrl: string, width: number, height: number, bytes: number }>}
 */
export async function fileToAvatarDataUrl(file, opts = {}) {
  const size = opts.size || AVATAR_SIZE
  const quality = opts.quality ?? AVATAR_QUALITY

  if (!file) throw new AvatarError('没有选择图片')
  if (!file.type || !file.type.startsWith('image/')) {
    throw new AvatarError('请选择图片文件（PNG / JPG）')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new AvatarError('图片太大，请上传 10MB 以内的图片')
  }

  const decoded = await decodeImage(file)
  try {
    if (!decoded.width || !decoded.height) {
      throw new AvatarError('图片尺寸异常，请换一张试试')
    }

    // ---- 1. 居中裁成正方形：取短边，从长边居中开切 ----
    const side = Math.min(decoded.width, decoded.height)
    const sx = Math.floor((decoded.width - side) / 2)
    const sy = Math.floor((decoded.height - side) / 2)

    // ---- 2. 缩放到目标尺寸 ----
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new AvatarError('当前环境不支持图片处理')

    // 缩小图片时浏览器默认的双线性采样会有锯齿，开高质量插值更平滑
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // JPEG 没有透明通道，先铺一层白底，否则 PNG 透明区域会变成黑块
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)

    ctx.drawImage(decoded.source, sx, sy, side, side, 0, 0, size, size)

    // ---- 3. 导出 JPEG ----
    let dataUrl
    try {
      dataUrl = canvas.toDataURL('image/jpeg', quality)
    } catch {
      throw new AvatarError('图片处理失败，请换一张试试')
    }

    // toDataURL 在极端情况下会返回 "data:,"（画布被污染或尺寸为 0）
    if (!dataUrl || !dataUrl.startsWith('data:image/jpeg')) {
      throw new AvatarError('图片处理失败，请换一张试试')
    }

    // 主动释放画布内存：128x128 很小，但这是好习惯，也便于 GC 及时回收
    canvas.width = 0
    canvas.height = 0

    return {
      dataUrl,
      width: size,
      height: size,
      // Base64 大约膨胀 4/3，这里给出实际字符数，便于日志核对压缩效果
      bytes: dataUrl.length,
    }
  } finally {
    decoded.release()
  }
}
