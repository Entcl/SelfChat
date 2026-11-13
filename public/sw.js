/* ============================================================
   大肥鱼 · Service Worker
   目标：让手机可以「添加到主屏幕」并以 PWA 形式启动，离线时
   至少能打开界面骨架（不是完整离线可用）。

   策略：
   - 导航请求：network-first，失败回落缓存的 index.html
   - 静态资源（assets/、图标）：cache-first，后台更新
   - /api/*：完全绕过 SW，直接走网络（数据必须实时，绝不缓存）
   ============================================================ */

const VERSION = 'v1'
const SHELL_CACHE = `dafeiyu-shell-${VERSION}`
const ASSET_CACHE = `dafeiyu-assets-${VERSION}`

// 预缓存的应用外壳。用相对路径，兼容 GitHub Pages 子路径部署。
const SHELL_URLS = ['./', './index.html', './favicon.svg', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // 逐个添加，单个失败不阻断整体安装
      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }))
          } catch (e) {
            /* 忽略单个资源失败 */
          }
        })
      )
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清理旧版本缓存
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k.startsWith('dafeiyu-') && !k.endsWith(VERSION))
          .map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

function isApiRequest(url) {
  return url.pathname.includes('/api/')
}

function isAssetRequest(url) {
  return (
    /\/assets\//.test(url.pathname) ||
    /\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?|ttf|ico)$/i.test(url.pathname)
  )
}

self.addEventListener('fetch', (event) => {
  const req = event.request

  // 只处理 GET；POST 等一律交给网络
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // 跨域请求不接管
  if (url.origin !== self.location.origin) return

  // API 请求绝不缓存：对话、存储、插件都是实时数据
  if (isApiRequest(url)) return

  // 页面导航：network-first，离线时回落到缓存的壳
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(SHELL_CACHE)
          cache.put('./index.html', fresh.clone()).catch(() => {})
          return fresh
        } catch (e) {
          const cache = await caches.open(SHELL_CACHE)
          const cached = (await cache.match('./index.html')) || (await cache.match('./'))
          if (cached) return cached
          return new Response('离线且无缓存', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }
      })()
    )
    return
  }

  // 静态资源：cache-first，同时后台刷新
  if (isAssetRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE)
        const cached = await cache.match(req)
        if (cached) {
          // 后台静默更新，不阻塞响应
          fetch(req)
            .then((res) => {
              if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
            })
            .catch(() => {})
          return cached
        }
        try {
          const res = await fetch(req)
          if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
          return res
        } catch (e) {
          return new Response('', { status: 504, statusText: 'Offline' })
        }
      })()
    )
  }
})
