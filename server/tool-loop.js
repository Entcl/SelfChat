/**
 * server/tool-loop.js
 * ============================================================
 * Function Calling（工具调用）编排层
 *
 * 职责：把「模型输出 tool_calls」翻译成「真的调用了本地工具」，
 * 再把工具结果回灌给模型生成最终回复。也就是用户那张时序图里
 * 第 ⑤⑥⑦ 步 —— 目前项目里唯一缺的那座桥。
 *
 * 设计取舍：
 *   - 第一轮强制非流式（stream:false）：工具调用场景不追求打字机效果，
 *     一次性拿到完整 JSON 才能可靠解析 arguments，避免拼流式碎片。
 *   - 第二轮是否流式由调用方决定，但最终这里统一以「非流式 JSON」回给前端，
 *     前端 streamChat 的非流式分支天然能解析（见 llm.js:180-194），无需改前端解析逻辑。
 *   - 最多 MAX_ROUNDS 轮，防止模型反复调工具导致死循环。
 *
 * 协议兼容：Ollama 与 OpenAI 兼容接口的 tool_calls 结构不同，这里做了归一：
 *   Ollama: message.tool_calls[].function.arguments 可能是对象或 JSON 字符串
 *   OpenAI: choices[0].message.tool_calls[].function.arguments 是 JSON 字符串
 * ============================================================
 */

const axios = require('axios')

const MAX_ROUNDS = 5

/**
 * 工具定义（OpenAI / Ollama 通用格式）。
 * name 必须和前端时序里的 generate_adshield_code 一致。
 */
const ADSHIELD_TOOL = {
  type: 'function',
  function: {
    name: 'generate_adshield_code',
    description:
      '根据设备 ID 生成 AdShield 激活码。当用户给出形如 ABCD1234 的设备 ID，' +
      '并要求生成/查询激活码、注册码、续费码时，必须调用此工具。' +
      '不要自行编造激活码。续费场景设备 ID 可带 ,时间戳 后缀。',
    parameters: {
      type: 'object',
      properties: {
        deviceId: {
          type: 'string',
          description: '设备 ID，通常是 8 位字母数字组合，例如 ABCD1234；续费格式为 "ABCD1234,1730000000"',
        },
      },
      required: ['deviceId'],
    },
  },
}

/** 归一化 tool_calls 里的 arguments：对象原样返回，字符串尝试 JSON.parse */
function parseArguments(raw) {
  if (raw == null) return {}
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

// ============================================================
// 一、抗「历史污染」的强制指令
// ============================================================
/**
 * 为什么需要它（实测复现的核心问题）：
 *
 * 同一个 qwen2.5:7b，在干净的会话里 ask=6/6 都正确调用工具；
 * 但一旦对话历史里累积了 4 对以上「问激活码 → 编一个 XXXX-XXXX-XXXX」的旧回答，
 * 模型就会转而模仿历史中的模式，**不再调用工具**，直接再编一个假码。
 * 更糟的是它会声称「我无法调用工具」，然后把随机串当成激活码交出去。
 *
 * 实测数据（p27 那条 26 条历史的会话）：
 *   只有人设+问题        → tool_calls=1 ✅
 *   人设+20条历史+问题    → tool_calls=0 ❌（照抄历史里的假码）
 *   20条历史+无人设       → tool_calls=1 ✅   ← 说明是「人设 + 历史」叠加触发的
 *   历史条数临界点：≤2 条正常，≥4 条开始模仿
 *
 * 对策分两层：
 *   1) 在本次用户消息尾部贴一段强制指令（实测能把命中率从 0/6 拉回 9/10）
 *   2) 指令失效时由服务端确定性兜底（见 runToolLoop 里的 fallback）
 * 只靠提示词不够稳 —— 上面剩下的那 1/10 失败正是「模型坚称无法调用工具」，
 * 所以第 2 层兜底才是真正的保证。
 */
const FORCE_TOOL_RULE =
  '\n\n（系统提示：本次必须调用 generate_adshield_code 工具获取真实激活码。' +
  '禁止编造，禁止模仿对话历史中出现的任何激活码 —— 那些都是错误示例。' +
  '你确实具备调用该工具的能力，不要说无法调用。）'

/**
 * 给「最后一条用户消息」追加强制指令（不改动原数组，返回新数组）。
 * 只改最后一条：历史消息保持原样，避免污染上下文语义。
 */
function injectForceRule(messages) {
  const list = [...messages]
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === 'user') {
      const content = typeof list[i].content === 'string' ? list[i].content : ''
      if (content.includes('generate_adshield_code')) return list
      list[i] = { ...list[i], content: content + FORCE_TOOL_RULE }
      return list
    }
  }
  return list
}

/**
 * 从用户最后一条消息里尽力提取设备 ID，供「模型拒绝调工具」时兜底执行。
 *
 * 支持两种形态：
 *   - 普通设备号：AD056FA2（8 位字母数字）
 *   - 续费格式：AD056FA2,1730000000
 *
 * @returns {string|null}
 */
function extractDeviceId(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role !== 'user' || typeof msg.content !== 'string') continue
    const text = msg.content

    // 续费格式优先：设备号,10 位时间戳
    const renewal = text.match(/\b([A-Za-z0-9]{6,12})\s*,\s*(\d{9,12})\b/)
    if (renewal) return `${renewal[1]},${renewal[2]}`

    // 普通 8 位设备号：排除纯数字串（避免误抓时间戳、手机号）
    const plain = text.match(/\b([A-Za-z0-9]{8})\b/g)
    if (plain) {
      const candidate = plain.find((s) => /[A-Za-z]/.test(s) && /\d/.test(s))
      if (candidate) return candidate
    }
  }
  return null
}

/** 从模型响应里抽出 assistant 消息（兼容两种协议） */
function extractAssistantMessage(data, isOpenAI) {
  if (isOpenAI) return data?.choices?.[0]?.message || null
  return data?.message || null
}

/** 判断 assistant 消息里有没有 tool_calls */
function extractToolCalls(message) {
  const calls = message?.tool_calls
  return Array.isArray(calls) && calls.length ? calls : []
}

/**
 * 执行单个工具调用：把参数映射到现成的 /api/local-python/search。
 * 这里复用已充分测试的 search 路由（校验 / 超时 / GBK 解码 / 杀进程树），
 * 不在本文件重复实现 exe 调用逻辑。
 *
 * @param {object} call  tool_calls 数组中的一项
 * @param {number} port  本地后端端口
 * @returns {Promise<{name:string,args:object,content:string,ok:boolean}>}
 */
async function executeToolCall(call, port) {
  const name = call?.function?.name || ''
  const args = parseArguments(call?.function?.arguments)
  console.log(`[tool-loop]   ⑥ 执行工具 name=%j args=%j`, name, args)

  if (name !== ADSHIELD_TOOL.function.name) {
    return { name, args, content: `未知工具：${name}`, ok: false }
  }

  const deviceId = String(args.deviceId ?? '').trim()
  if (!deviceId) {
    return { name, args, content: '工具参数缺失：deviceId 不能为空', ok: false }
  }

  try {
    const response = await axios.post(
      `http://127.0.0.1:${port}/api/local-python/search`,
      { keyword: deviceId },
      { timeout: 20000, validateStatus: () => true }
    )
    const body = response.data || {}
    if (response.status >= 400 || body.ok === false) {
      return {
        name,
        args,
        content: `工具执行失败：${body.error || `HTTP ${response.status}`}`,
        ok: false,
      }
    }
    return { name, args, content: String(body.result ?? ''), ok: true }
  } catch (err) {
    return { name, args, content: `工具执行失败：${err.message}`, ok: false }
  }
}

/**
 * 以非流式请求模型一轮。
 */
async function callModelOnce({ finalTargetUrl, targetHeaders, proxyUrl, proxyAgent, payload }) {
  const response = await axios({
    method: 'post',
    url: finalTargetUrl,
    headers: targetHeaders,
    data: payload,
    responseType: 'json',
    validateStatus: () => true,
    timeout: 180000,
    ...(proxyAgent ? { httpsAgent: proxyAgent } : {}),
  })
  if (response.status >= 400) {
    const msg = response.data?.error?.message || response.data?.error || `HTTP ${response.status}`
    throw new Error(`模型请求失败：${typeof msg === 'string' ? msg : JSON.stringify(msg)}`)
  }
  return response.data
}

/**
 * 主入口：处理一次带工具能力的对话。
 *
 * @param {object} opts
 * @param {import('express').Response} opts.res
 * @param {string[]} opts.messages       已经过插件钩子的消息数组
 * @param {object}  opts.restPayload     前端 payload（model / options 等）
 * @param {string}  opts.finalTargetUrl  最终模型地址（已替换 /api 前缀）
 * @param {object}  opts.targetHeaders
 * @param {string}  opts.proxyUrl
 * @param {Function|null} opts.buildProxyAgent
 * @param {boolean} opts.isOpenAI
 * @param {number}  opts.port            本地后端端口
 */
async function runToolLoop({
  res,
  messages,
  restPayload,
  finalTargetUrl,
  targetHeaders,
  proxyUrl,
  buildProxyAgent,
  isOpenAI,
  port,
}) {
  const proxyAgent = buildProxyAgent ? buildProxyAgent(proxyUrl, finalTargetUrl) : null
  // 工具编排期间一律非流式：拿完整 JSON 才好解析 tool_calls
  const basePayload = { ...restPayload, stream: false }
  // 追加强制指令：抵抗「历史里假激活码太多 → 模型转而模仿编造」的污染问题
  const workingMessages = injectForceRule(messages)
  let finalText = ''
  let lastUsage = null
  let executedAny = false
  // 模型中「拒绝调用工具却直接编答案」时触发兜底，只兜一次
  let fallbackTried = false

  console.log(`[tool-loop] ① 收到请求，注入 tools 定义，model=%j`, basePayload.model)

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`[tool-loop] ②③ 第 ${round}/${MAX_ROUNDS} 轮请求模型（stream:false）`)
    const data = await callModelOnce({
      finalTargetUrl,
      targetHeaders,
      proxyUrl,
      proxyAgent,
      payload: { ...basePayload, messages: workingMessages, tools: [ADSHIELD_TOOL] },
    })

    const assistantMsg = extractAssistantMessage(data, isOpenAI)
    if (!assistantMsg) throw new Error('模型响应里没有 message 字段')

    const toolCalls = extractToolCalls(assistantMsg)
    const content = typeof assistantMsg.content === 'string' ? assistantMsg.content : ''

    // 记录 usage / eval_count 供前端统计
    lastUsage = isOpenAI
      ? data?.usage?.completion_tokens
        ? { tokens: Number(data.usage.completion_tokens) }
        : null
      : data?.eval_count
        ? { tokens: Number(data.eval_count) }
        : null

    if (!toolCalls.length) {
      // ========================================================
      // 兜底：模型没调用工具，但用户在问激活码。
      //
      // 这是「历史污染」最坏的形态 —— 模型被历史里的假激活码带偏后，
      // 会声称「我无法调用工具」然后现编一个 XXXX-XXXX-XXXX 交差。
      // 提示词只能把命中率拉到 9/10，剩下的那一次必须由服务端兜住：
      // 直接从用户消息里取设备 ID，真的去 spawn 一次 exe，用真实结果作答。
      //
      // 只在能确定设备 ID 时才兜底，取不到就保持模型原本的回复，
      // 免得把「你好」这种闲聊也强行兜成激活码。
      // ========================================================
      if (!fallbackTried && !executedAny) {
        const deviceId = extractDeviceId(messages)
        if (deviceId) {
          fallbackTried = true
          console.warn(
            `[tool-loop] ⚠ 模型未调用工具却直接作答，启用服务端兜底：deviceId=%j`,
            deviceId
          )
          const outcome = await executeToolCall(
            {
              function: {
                name: ADSHIELD_TOOL.function.name,
                arguments: { deviceId },
              },
            },
            port
          )
          executedAny = true

          if (outcome.ok) {
            // 真实结果拿到手，直接作为最终回复。
            // 不再回灌给模型改写 —— 它刚被历史带偏，让它复述反而可能再次编造。
            finalText = String(outcome.content || '').trim()
            console.log(`[tool-loop] ✅ 兜底成功，已用真实插件输出覆盖模型编造内容`)
            break
          }
          console.warn(`[tool-loop] 兜底执行也失败：%j`, String(outcome.content).slice(0, 200))
        }
      }

      console.log(`[tool-loop] ⑧⑨ 第 ${round} 轮无 tool_calls，得到最终自然语言回复（${content.length} 字）`)
      finalText = content
      break
    }

    if (round === MAX_ROUNDS) {
      console.warn(`[tool-loop] 达到最大轮数 ${MAX_ROUNDS}，强制结束并把最后一轮文本作为回复`)
      finalText = content
      break
    }

    console.log(
      `[tool-loop] ④⑤ 检出 tool_calls（${toolCalls.length} 个），模型未给出自然语言内容`
    )

    // 把 assistant 的 tool_calls 消息原样追加进上下文，模型靠它知道自己刚才要调什么
    workingMessages.push(assistantMsg)

    // 逐个执行工具，结果以 role=tool 追加（对应时序图第 ⑥⑦ 步）
    for (const call of toolCalls) {
      const outcome = await executeToolCall(call, port)
      executedAny = true
      console.log(
        `[tool-loop] ⑥ 工具结果 ok=%s content=%j`,
        outcome.ok,
        String(outcome.content).slice(0, 200)
      )
      const toolMessage = isOpenAI
        ? {
            role: 'tool',
            tool_call_id: call.id || call.function?.name || 'call_0',
            content: outcome.content,
          }
        : {
            role: 'tool',
            content: outcome.content,
          }
      workingMessages.push(toolMessage)
    }
  }

  if (!executedAny) {
    console.log('[tool-loop] 本轮对话未触发任何工具调用（模型判断不需要）')
  }

  // ============================================================
  // 回写前端：必须按「前端当初怎么问的」来回答。
  //
  // 前端 src/api/llm.js 有两条完全不同的解析分支，取决于 useStream：
  //   - stream=true  → 走 SSE 行解析。OpenAI 协议只认带 `data:` 前缀的行，
  //                    不带前缀会被 handleLine 直接丢弃 —— 整段回复变成空气。
  //   - stream=false → 直接 response.json()。
  //
  // 早期版本这里无视 useStream 一律返回 JSON，于是「模型明明生成了正确激活码，
  // 界面却是空白消息」。修法：跟着请求的 stream 标志走，两种格式各自正确。
  // ============================================================
  const wantsStream = restPayload?.stream !== false

  if (!wantsStream) {
    res.setHeader('Content-Type', 'application/json')
    if (isOpenAI) {
      return res.json({
        choices: [{ message: { role: 'assistant', content: finalText }, finish_reason: 'stop' }],
        usage: { completion_tokens: lastUsage?.tokens ?? 1 },
      })
    }
    return res.json({
      message: { role: 'assistant', content: finalText },
      done: true,
      eval_count: lastUsage?.tokens ?? 1,
      eval_duration: 100000000,
    })
  }

  // ---- 流式分支：把已经算好的最终文本包装成 SSE 帧 ----
  // 注意：工具编排本身仍是非流式（要拿完整 JSON 才能解析 tool_calls），
  // 这里只是把最终结果按 SSE 协议吐出去，让前端那条解析路径能正常收下。
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  if (isOpenAI) {
    if (finalText) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: finalText } }] })}\n\n`)
    }
    res.write(
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { completion_tokens: lastUsage?.tokens ?? 1 },
      })}\n\n`
    )
    res.write('data: [DONE]\n\n')
  } else {
    if (finalText) {
      res.write(
        `${JSON.stringify({ message: { role: 'assistant', content: finalText }, done: false })}\n`
      )
    }
    res.write(
      `${JSON.stringify({
        message: { role: 'assistant', content: '' },
        done: true,
        eval_count: lastUsage?.tokens ?? 1,
        eval_duration: 100000000,
      })}\n`
    )
  }
  return res.end()
}

module.exports = { runToolLoop, ADSHIELD_TOOL }
