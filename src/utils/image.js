/**
 * 头像图片处理：静态图压缩成 JPEG DataURL；GIF 动图原样保存成 DataURL。
 *
 * ============ 为什么静态图必须压缩 ============
 * 用户随手选的一张手机照片可能就是 4~8MB，转成 Base64 还要再涨 33%。
 * 之前 SettingsPanel / MessageBubble 里都是 readAsDataURL 直接把原图塞进
 * profile blob，实测把 `w1::sc.user.profile.v1` 撑到了 2.2MB，
 * 而这个 blob 每次改名都要整体写一遍 SQLite —— 界面会明显卡顿。
 *
 * 这里统一压到 128x128 JPEG(q=0.8)，单张稳定在 3~8KB，彻底消除这个隐患。
 *
 * ============ 为什么 GIF 必须走另一条路 ============
 * 上面的压缩管线是「解码成位图 → 画到 canvas → toDataURL('image/jpeg')」。
 * canvas 只承载**当前一帧**，导出的是静态图 —— GIF 的动画会 100% 丢失。
 * 而且无论换成 png / webp 导出都一样，canvas 本身就不保留帧序列。
 *
 * 因此 GIF 走「原样读取为 DataURL」分支：不裁剪、不缩放、不转码，
 * 原始字节完整保留，`<img src="data:image/gif;base64,...">` 就能正常播放动画。
 * 代价是不能压缩，改用体积上限（MAX_GIF_BYTES）+ 尺寸提示来约束，
 * 既保住动画，又不至于让 profile blob 无限膨胀。
 *
 * ⚠️ 对调用方透明：直接调 fileToAvatarDataUrl(file) 即可，
 * 内部会自动判断是不是 GIF 并分流，调用方无需自己写分支。
 */

/** 头像最终边长（px）。128 足够 2x 屏上 38px 头像清晰显示 */
export const AVATAR_SIZE = 128

/** JPEG 质量。0.8 是体积/画质的拐点，再高体积涨得很快而肉眼几乎无差别 */
export const AVATAR_QUALITY = 0.8

/** 允许的输入类型（含 GIF 动图） */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/**
 * 给 <input type="file" accept> 用的字符串。
 *
 * 三处头像入口（AiAvatar / MessageBubble / SettingsPanel）统一引用它，
 * 避免像以前那样各处手写一份、改一处漏两处（GIF 就是这么漏掉的）。
 */
export const AVATAR_ACCEPT_ATTR = ACCEPTED_IMAGE_TYPES.join(', ')

/** 静态图输入体积上限，超过直接拒绝（避免在解码阶段就吃掉大量内存） */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024

/**
 * GIF 动图体积上限。
 *
 * 动图无法压缩（压了就丢动画），只能靠上限约束。这个值不是随便定的：
 *
 * profile blob（`wN::sc.user.profile.v1`）是一个整体 JSON，改一次 AI 称呼
 * 就要把**整块**重写一遍 SQLite —— 包括里面的头像 Base64。这正是当初做
 * 静态图压缩的原因（实测 2.2MB 的 blob 逐键写入会明显卡顿）。
 *
 * 所以上限按「Base64 后不超过历史痛点 2.2MB」倒推：
 *   1.5MB × 4/3 ≈ 2.0MB —— 与压缩管线落地前的量级持平，不会让体验倒退。
 * 再配合 user.js 里 300ms 的写入防抖，实际压力可控。
 *
 * 1.5MB 也覆盖了绝大多数网上存的动图头像（通常 200KB ~ 1MB）。
 * 若将来确实需要更大的动图，正确的做法是把头像拆到独立的 KV key，
 * 让改名不再重写头像，而不是继续抬高这个上限。
 */
export const MAX_GIF_BYTES = 1.5 * 1024 * 1024

/** 超过这个体积的动图给一条「加载可能稍慢」的提示（不阻止使用） */
const GIF_HINT_BYTES = 700 * 1024

/** 动图逻辑尺寸超过这个值就提示（头像显示区域只有 38~52px） */
const GIF_HINT_EDGE = 512

export class AvatarError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AvatarError'
  }
}

/** 把字节数格式化成 1.2MB / 860KB 这种可读形式，用于错误提示 */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
  if (n >= 1024) return `${Math.round(n / 1024)}KB`
  return `${n}B`
}

const GIF_EXT_RE = /\.gif$/i

/**
 * 判断是不是 GIF 动图。
 *
 * 不能只看 MIME：不同系统 / 浏览器对本地文件可能给不出 type，
 * 或者给个 `application/octet-stream`。所以 MIME 认不出时再看扩展名。
 *
 * @param {File} file
 * @returns {boolean}
 */
export function isGifFile(file) {
  if (!file) return false
  const type = String(file.type || '').toLowerCase()
  if (type === 'image/gif') return true
  const unknownType = !type || type === 'application/octet-stream'
  return unknownType && GIF_EXT_RE.test(String(file.name || ''))
}

/** 用 FileReader 把文件读成 DataURL（保留原始字节，不做任何转码） */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new AvatarError('图片读取失败，请换一张试试'))
    reader.readAsDataURL(file)
  })
}

/**
 * 只读 GIF 头部 10 字节拿逻辑屏幕尺寸，不做解码。
 *
 * GIF 头结构：0-2 "GIF"、3-5 版本、6-7 宽、8-9 高（均为小端 uint16）。
 * 这样能在不解码整张动图的前提下给出尺寸提示。
 */
async function readGifHeaderSize(file) {
  try {
    const header = await file.slice(0, 10).arrayBuffer()
    const bytes = new Uint8Array(header)
    if (bytes.length < 10) return { width: 0, height: 0 }
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2])
    if (magic !== 'GIF') return { width: 0, height: 0 }
    return {
      width: bytes[6] | (bytes[7] << 8),
      height: bytes[8] | (bytes[9] << 8),
    }
  } catch {
    // 读头失败不影响主流程：只是没有尺寸提示而已
    return { width: 0, height: 0 }
  }
}

/**
 * 把 GIF 动图原样转成 DataURL（保留动画）。
 *
 * @param {File} file
 * @param {{ maxBytes?: number }} [opts]
 * @returns {Promise<{ dataUrl: string, width: number, height: number, bytes: number, kind: 'gif', warn: string }>}
 */
export async function fileToGifAvatarDataUrl(file, opts = {}) {
  const maxBytes = opts.maxBytes || MAX_GIF_BYTES

  if (!file) throw new AvatarError('没有选择图片')
  if (!isGifFile(file)) throw new AvatarError('请选择 GIF 动图文件')
  if (file.size > maxBytes) {
    throw new AvatarError(
      `GIF 动图请控制在 ${formatBytes(maxBytes)} 以内（当前 ${formatBytes(file.size)}）`,
    )
  }

  const dataUrl = await readAsDataUrl(file)
  if (!dataUrl.startsWith('data:image/gif')) {
    throw new AvatarError('GIF 读取失败，请换一张试试')
  }

  const { width, height } = await readGifHeaderSize(file)

  // 提示而非拦截：能播放的动图就让它用，只是提醒一下体积/尺寸偏大
  let warn = ''
  if (file.size > GIF_HINT_BYTES) {
    warn = `动图较大（${formatBytes(file.size)}），已原样保存，显示时可能稍慢`
  } else if (Math.max(width, height) > GIF_HINT_EDGE) {
    warn = `动图尺寸 ${width}×${height}，头像区域较小，建议裁成正方形后使用`
  }

  return {
    dataUrl,
    width,
    height,
    // 与静态图分支保持同名字段：这里给的是 DataURL 字符数，便于日志核对体积
    bytes: dataUrl.length,
    kind: 'gif',
    warn,
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
 * GIF 会自动分流到 fileToGifAvatarDataUrl（原样保留动画），
 * 其余格式走 canvas 压缩管线。
 *
 * @param {File} file 用户选择的文件
 * @param {{ size?: number, quality?: number, maxGifBytes?: number }} [opts]
 * @returns {Promise<{ dataUrl: string, width: number, height: number, bytes: number, kind?: 'gif', warn?: string }>}
 */
export async function fileToAvatarDataUrl(file, opts = {}) {
  if (!file) throw new AvatarError('没有选择图片')

  // ---- GIF 分流：必须放在最前面，绝不能让动图进 canvas 管线（会丢动画）----
  if (isGifFile(file)) {
    return fileToGifAvatarDataUrl(file, { maxBytes: opts.maxGifBytes })
  }

  const size = opts.size || AVATAR_SIZE
  const quality = opts.quality ?? AVATAR_QUALITY

  if (!file.type || !file.type.startsWith('image/')) {
    throw new AvatarError('请选择图片文件（PNG / JPG / WebP / GIF）')
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
