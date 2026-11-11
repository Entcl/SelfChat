import { download, formatDateTime, safeFileName } from './format'

export function sessionToMarkdown(session) {
  const lines = [
    `# ${session.title}`,
    '',
    `> 由「大肥鱼 · AI 对话工作台」导出 · ${formatDateTime(Date.now())} · 共 ${session.messages.length} 条消息`,
    '',
  ]

  session.messages.forEach((message) => {
    const who = message.role === 'user' ? '🧑 我' : '🐟 大肥鱼'
    const stamp = message.createdAt ? formatDateTime(message.createdAt) : ''
    lines.push(`## ${who}${stamp ? `　<sub>${stamp}</sub>` : ''}`, '')
    lines.push(message.content?.trim() || (message.error ? `> ⚠️ ${message.error}` : '_（空消息）_'))
    lines.push('')
  })

  return lines.join('\n')
}

export function sessionToJSON(session) {
  return {
    title: session.title,
    createdAt: session.createdAt,
    exportedAt: new Date().toISOString(),
    app: '大肥鱼 AI Chat',
    messages: session.messages.map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      model: message.model,
      error: message.error || undefined,
    })),
  }
}

export function exportSession(session, format = 'md') {
  if (!session) return
  const base = safeFileName(session.title, 'chat')
  const stamp = new Date().toISOString().slice(0, 10)
  if (format === 'json') {
    download(`${base}-${stamp}.json`, JSON.stringify(sessionToJSON(session), null, 2), 'application/json;charset=utf-8')
  } else {
    download(`${base}-${stamp}.md`, sessionToMarkdown(session), 'text/markdown;charset=utf-8')
  }
}

export function exportAllSessions(sessions) {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: '大肥鱼 AI Chat',
    sessions: sessions.map(sessionToJSON),
  }
  download(`大肥鱼-全部对话-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8')
}
