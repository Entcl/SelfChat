/**
 * 轻量 Markdown 渲染器（零依赖）
 * ------------------------------------------------------------------
 * 支持：标题 / 段落 / 粗斜体 / 删除线 / 行内代码 / 围栏代码块（含复制按钮）
 *      有序无序列表（含嵌套、任务列表）/ 引用 / 表格 / 分割线 / 链接 / 图片降级为链接
 * 安全：所有原始 HTML 一律转义，不执行任何模型输出的标签，链接仅允许 http(s) / mailto / 站内路径
 */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch])
}

const SAFE_URL = /^(https?:\/\/|mailto:|\/|#)/i

function safeUrl(url) {
  const raw = String(url || '').trim()
  if (!raw || !SAFE_URL.test(raw)) return ''
  return raw.replace(/["'<>`]/g, (ch) => encodeURIComponent(ch))
}

/* ------------------------------ 代码高亮 ------------------------------ */

const ALIASES = {
  js: 'js',
  javascript: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  ts: 'js',
  typescript: 'js',
  tsx: 'js',
  vue: 'html',
  html: 'html',
  xml: 'html',
  svg: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  py: 'py',
  python: 'py',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
  shell: 'sh',
  console: 'sh',
  json: 'json',
  yaml: 'sh',
  yml: 'sh',
  toml: 'sh',
  sql: 'sql',
  go: 'js',
  rust: 'js',
  java: 'js',
  kotlin: 'js',
  swift: 'js',
  c: 'js',
  cpp: 'js',
  cs: 'js',
  php: 'js',
  ruby: 'py',
  lua: 'sql',
  markdown: 'text',
  md: 'text',
  diff: 'text',
  text: 'text',
}

const RAW_KEYWORDS = {
  js: 'const let var function return if else for while do switch case break continue new class extends super import export from default async await try catch finally throw typeof instanceof in of this null undefined true false void delete yield static get set interface type enum implements public private protected readonly declare namespace as keyof infer',
  py: 'def class return if elif else for while in not and or is None True False import from as try except finally raise with lambda yield global nonlocal pass break continue assert async await del print self match case',
  sh: 'if then else elif fi for while do done case esac in function return export local echo cd ls cat grep rm mkdir sudo npm pnpm yarn node python pip git docker curl set unset alias source',
  json: 'true false null',
  css: '',
  html: '',
  sql: 'SELECT FROM WHERE INSERT INTO UPDATE DELETE CREATE TABLE ALTER DROP JOIN LEFT RIGHT INNER OUTER ON GROUP BY ORDER HAVING LIMIT OFFSET AS AND OR NOT NULL VALUES SET PRIMARY KEY FOREIGN REFERENCES INDEX UNIQUE DEFAULT DISTINCT UNION ALL CASE WHEN THEN END',
  text: '',
}

const KEYWORD_SETS = Object.create(null)
for (const [lang, raw] of Object.entries(RAW_KEYWORDS)) {
  KEYWORD_SETS[lang] = new Set(raw.split(/\s+/).filter(Boolean))
}

const SLASH_COMMENT_LANGS = new Set(['js', 'css', 'html'])
const HASH_COMMENT_LANGS = new Set(['py', 'sh'])
const DASH_COMMENT_LANGS = new Set(['sql'])

function highlight(code, rawLang) {
  const lang = ALIASES[String(rawLang || '').toLowerCase()] || 'text'
  if (lang === 'text') return escapeHtml(code)

  let html = escapeHtml(code)
  const stash = []
  const keep = (cls, content) => {
    stash.push(`<span class="tok-${cls}">${content}</span>`)
    return `\u0000z${stash.length - 1}z\u0000`
  }

  if (SLASH_COMMENT_LANGS.has(lang)) {
    html = html.replace(/\/\*[\s\S]*?\*\//g, (m) => keep('comment', m))
  }

  // 字符串：反引号 / 双引号 / 单引号（已转义为实体）
  html = html.replace(/`[^`\n]*`/g, (m) => keep('string', m))
  html = html.replace(/&quot;[^\n]*?&quot;/g, (m) => keep('string', m))
  html = html.replace(/&#39;[^\n]*?&#39;/g, (m) => keep('string', m))

  if (SLASH_COMMENT_LANGS.has(lang)) {
    html = html.replace(/(^|\n)([^\n]*?)(\/\/[^\n]*)/g, (m, nl, before, comment) => `${nl}${before}${keep('comment', comment)}`)
  }
  if (HASH_COMMENT_LANGS.has(lang)) {
    html = html.replace(/(^|\n)([^\n]*?)(#[^\n]*)/g, (m, nl, before, comment) => `${nl}${before}${keep('comment', comment)}`)
  }
  if (DASH_COMMENT_LANGS.has(lang)) {
    html = html.replace(/(^|\n)([^\n]*?)(--[^\n]*)/g, (m, nl, before, comment) => `${nl}${before}${keep('comment', comment)}`)
  }

  const words = KEYWORD_SETS[lang]
  if (words && words.size) {
    html = html.replace(/\b([A-Za-z_$][\w$]*)\b/g, (m) => (words.has(m) ? keep('keyword', m) : m))
  }

  html = html.replace(/(?<![\w&])#?(0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/g, (m) => keep('number', m))

  return html.replace(/\u0000z(\d+)z\u0000/g, (_, i) => stash[Number(i)] ?? '')
}

function renderCodeBlock(code, lang = '') {
  const label = (lang || 'text').toLowerCase()
  return (
    '<div class="code-card">' +
    `<div class="code-head"><span class="code-lang">${escapeHtml(label)}</span>` +
    '<button type="button" class="code-copy" aria-label="复制代码">复制</button></div>' +
    `<pre class="code-pre"><code>${highlight(code, label)}</code></pre>` +
    '</div>'
  )
}

/* ------------------------------ 行内语法 ------------------------------ */

function inline(raw) {
  const codes = []
  let text = escapeHtml(raw).replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(code)
    return `\u0000c${codes.length - 1}c\u0000`
  })

  // 图片对聊天意义不大，降级为可点击链接
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, url) => {
    const href = safeUrl(url)
    return href ? `<a class="md-image" href="${href}" target="_blank" rel="noopener noreferrer">🖼 ${alt || href}</a>` : match
  })

  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
    const href = safeUrl(url)
    return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : label
  })

  // 裸链接（避免命中已生成的 href="…"）
  text = text.replace(/(^|[\s（(])(https?:\/\/[^\s<）)]+)/g, (match, prefix, url) => {
    const href = safeUrl(url)
    return href ? `${prefix}<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>` : match
  })

  text = text.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/__([^\n]+?)__/g, '<strong>$1</strong>')
  text = text.replace(/~~([^\n]+?)~~/g, '<del>$1</del>')
  text = text.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
  text = text.replace(/(^|[^A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])/g, '$1<em>$2</em>')

  return text.replace(/\u0000c(\d+)c\u0000/g, (_, i) => `<code class="md-inline-code">${codes[Number(i)] ?? ''}</code>`)
}

/* ------------------------------ 列表 ------------------------------ */

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

function renderList(items) {
  if (!items.length) return ''
  const root = { children: [], ordered: items[0].ordered, indent: items[0].indent }
  const stack = [root]

  for (const item of items) {
    while (stack.length > 1 && item.indent < stack[stack.length - 1].indent) stack.pop()
    let parent = stack[stack.length - 1]

    if (item.indent > parent.indent && parent.children.length) {
      const child = { children: [], ordered: item.ordered, indent: item.indent }
      parent.children[parent.children.length - 1].child = child
      stack.push(child)
      parent = child
    } else if (item.indent > parent.indent) {
      parent.indent = item.indent
    }

    parent.children.push({ text: item.text, child: null })
  }

  const renderNode = (node) => {
    const tag = node.ordered ? 'ol' : 'ul'
    const body = node.children
      .map((child) => {
        const task = child.text.match(/^\[([ xX])\]\s+([\s\S]*)$/)
        const head = task
          ? `<span class="md-task${task[1].trim() ? ' is-done' : ''}" aria-hidden="true"></span>${inline(task[2])}`
          : inline(child.text)
        return `<li>${head}${child.child ? renderNode(child.child) : ''}</li>`
      })
      .join('')
    return `<${tag}>${body}</${tag}>`
  }

  return renderNode(root)
}

/* ------------------------------ 表格 ------------------------------ */

function splitRow(line) {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|')) row = row.slice(0, -1)
  return row.split('|').map((cell) => cell.trim())
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function renderTable(headerLine, separatorLine, rows) {
  const head = splitRow(headerLine)
  const aligns = splitRow(separatorLine).map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return ''
  })

  const cellHtml = (tag, cell, index) => {
    const align = aligns[index] ? ` style="text-align:${aligns[index]}"` : ''
    return `<${tag}${align}>${inline(cell)}</${tag}>`
  }

  const thead = `<thead><tr>${head.map((cell, i) => cellHtml('th', cell, i)).join('')}</tr></thead>`
  const tbody = rows.length
    ? `<tbody>${rows
        .map((cells) => `<tr>${head.map((_, i) => cellHtml('td', cells[i] ?? '', i)).join('')}</tr>`)
        .join('')}</tbody>`
    : ''

  return `<div class="md-table-wrap"><table>${thead}${tbody}</table></div>`
}

/* ------------------------------ 主渲染 ------------------------------ */

export function renderMarkdown(source) {
  const src = String(source ?? '').replace(/\r\n?/g, '\n')
  if (!src.trim()) return ''

  const lines = src.split('\n')
  let html = ''
  let paragraph = []
  let i = 0

  const flushParagraph = () => {
    if (!paragraph.length) return
    html += `<p>${paragraph.map((line) => inline(line)).join('<br />')}</p>`
    paragraph = []
  }

  while (i < lines.length) {
    const line = lines[i]

    // 空行
    if (!line.trim()) {
      flushParagraph()
      i += 1
      continue
    }

    // 围栏代码块
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w#+.-]*)\s*$/)
    if (fence) {
      flushParagraph()
      const marker = fence[1]
      const lang = fence[2] || ''
      const buffer = []
      i += 1
      while (i < lines.length && !new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) {
        buffer.push(lines[i])
        i += 1
      }
      i += 1 // 跳过结束围栏（若未闭合也安全）
      html += renderCodeBlock(buffer.join('\n'), lang)
      continue
    }

    // 只有井号的残缺标题（流式中途截断）直接忽略
    if (/^\s*#{1,6}\s*$/.test(line)) {
      i += 1
      continue
    }

    // 标题
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      const level = heading[1].length
      html += `<h${level}>${inline(heading[2].trim())}</h${level}>`
      i += 1
      continue
    }

    // 分割线
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushParagraph()
      html += '<hr />'
      i += 1
      continue
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushParagraph()
      const headerLine = line
      const separatorLine = lines[i + 1]
      const rows = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]))
        i += 1
      }
      html += renderTable(headerLine, separatorLine, rows)
      continue
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      flushParagraph()
      const buffer = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buffer.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      html += `<blockquote>${renderMarkdown(buffer.join('\n'))}</blockquote>`
      continue
    }

    // 列表
    if (LIST_ITEM.test(line)) {
      flushParagraph()
      const items = []
      while (i < lines.length) {
        const match = lines[i].match(LIST_ITEM)
        if (!match) break
        items.push({
          indent: match[1].replace(/\t/g, '  ').length,
          ordered: /^\d/.test(match[2]),
          text: match[3],
        })
        i += 1
      }
      html += renderList(items)
      continue
    }

    // 普通段落
    paragraph.push(line)
    i += 1
  }

  flushParagraph()
  return html
}
