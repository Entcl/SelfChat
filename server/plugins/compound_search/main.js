const fs = require('fs')
const path = require('path')
const axios = require('axios')

// ================= 初始化城市数据缓存 =================
let cityMap = {}
let nameWithCity = {}

const rawCachePath = path.join(__dirname, 'city_data_raw.json')

function buildCaches(cityData) {
  cityMap = {}
  nameWithCity = {}

  for (const province in cityData) {
    const cities = cityData[province]
    for (const cityName in cities) {
      const districts = cities[cityName]
      for (const districtName in districts) {
        const info = districts[districtName]
        const code = info.AREAID
        if (!code) continue

        let fullName = districtName
        if (cityName === districtName && province === cityName) {
          fullName = cityName
        } else if (cityName === districtName) {
          fullName = `${province}${cityName}`
        } else {
          fullName = `${cityName}${districtName}`
        }

        nameWithCity[districtName] = fullName
        nameWithCity[fullName] = fullName
        cityMap[cityName] = code
        cityMap[fullName] = code
        if (!cityMap[districtName]) cityMap[districtName] = code
      }
    }
  }
}

try {
  if (fs.existsSync(rawCachePath)) {
    const rawData = fs.readFileSync(rawCachePath, 'utf-8')
    buildCaches(JSON.parse(rawData))
    console.log('[复合搜索] ✅ 城市数据加载成功，共', Object.keys(cityMap).length, '个节点')
  }
} catch (err) {
  console.error('[复合搜索] ❌ 城市数据加载失败:', err.message)
}

// ================= Emoji 辅助函数 =================
function getEmoji(weatherText, tempStr = '') {
  if (weatherText.includes('雷')) return '⛈️'
  if (weatherText.includes('雪')) return '❄️'
  if (weatherText.includes('雨')) return '🌧️'
  if (weatherText.includes('雾') || weatherText.includes('霾')) return '🌫️'
  if (weatherText.includes('阴')) return '☁️'
  if (weatherText.includes('多云')) return '⛅'
  if (weatherText.includes('晴')) return '☀️'
  try {
    const nums = tempStr.match(/-?\d+(?:\.\d+)?/g)
    if (nums) {
      const t = parseFloat(nums[0])
      if (t >= 35) return '🥵'
      if (t <= 0) return '🥶'
    }
  } catch (e) {}
  return '🌤️'
}

function getHumidityEmoji(humidityStr) {
  try {
    const val = parseInt(humidityStr.replace('%', '').trim())
    if (val < 30) return '🍂'
    if (val > 70) return '🌊'
    return '💧'
  } catch (e) { return '💧' }
}

function getWindEmoji(windPower) {
  try {
    const nums = windPower.match(/\d+/g)
    if (nums) {
      const val = parseInt(nums[nums.length - 1])
      if (val >= 6) return '🌪️'
      if (val >= 4) return '💨'
      return '🍃'
    }
  } catch (e) {}
  return '🍃'
}

// ================= 天气接口工具函数 =================
const weatherHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://www.weather.com.cn/'
}

async function fetchTodayWeather(cityId) {
  const url = `http://d1.weather.com.cn/sk_2d/${cityId}.html`
  try {
    const res = await axios.get(url, { headers: weatherHeaders, timeout: 10000 })
    const text = res.data
    
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) return null

    const info = JSON.parse(text.substring(start, end + 1))
    
    let temp = (info.temp === '999' || info.temp === '999.0' || !info.temp) ? '?' : info.temp
    const weather = String(info.weather || '').trim()
    const sd = info.SD ? (String(info.SD).includes('%') ? String(info.SD) : `${info.SD}%`) : ''
    
    let wd = String(info.WD || '').trim()
    let ws = String(info.WS || '').trim()
    if (wd.includes('⊃') || wd.includes('?')) wd = '未知风向'
    if (ws.includes('组')) ws = ws.replace('组', '级')

    const parts = [`今日${temp}℃`, weather, getEmoji(weather, String(temp))]
    if (sd) parts.push(`相对湿度${sd}${getHumidityEmoji(sd)}`)
    if (wd || ws) {
      const windStr = `${wd}${ws}`
      parts.push(`${windStr}${ws ? getWindEmoji(ws) : '🍃'}`)
    }
    
    return parts.filter(Boolean).join(' ')
  } catch (err) {
    console.error('[天气] 实时天气请求失败:', err.message)
    return null
  }
}

async function fetchForecast(cityId, dateOffset) {
  const url = `https://www.weather.com.cn/weather/${cityId}.shtml`
  const dateWord = dateOffset === 1 ? '明天' : '后天'
  try {
    const res = await axios.get(url, { headers: weatherHeaders, timeout: 10000 })
    const text = res.data
    const ulMatch = text.match(/<ul class="t clearfix">([\s\S]*?)<\/ul>/)
    if (!ulMatch) return null

    const liBlocks = ulMatch[1].match(/<li[^>]*>([\s\S]*?)<\/li>/g) || []
    if (liBlocks.length <= dateOffset) return null

    const targetBlock = liBlocks[dateOffset]
    const weaMatch = targetBlock.match(/<p[^>]*class="wea"[^>]*>(.*?)<\/p>/)
    const weather = weaMatch ? weaMatch[1].replace(/<[^>]+>/g, '').trim() : ''

    let tempStr = ''
    const temMatch = targetBlock.match(/<p[^>]*class="tem"[^>]*>([\s\S]*?)<\/p>/)
    if (temMatch) {
      tempStr = temMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim()
    }

    return `${dateWord} ${tempStr} ${weather} ${getEmoji(weather, tempStr)}`
  } catch (err) {
    console.error('[天气] 预报请求失败:', err.message)
    return null
  }
}

// ================= 联网搜索工具函数 =================
async function fetchSearxng(query, baseUrl = 'http://127.0.0.1:8888', maxResults = 5) {
  const url = `${baseUrl.replace(/\/+$/, '')}/search`
  try {
    const res = await axios.get(url, {
      params: { q: query, format: 'json' },
      headers: { 'Accept': 'application/json' },
      timeout: 30000 
    })
    
    const results = res.data.results || []
    if (!results.length) return null

    // 👈 核心修改：直接在代码里把搜索列表排版成完美的 Markdown
    let mdText = `为你找到了关于 **${query}** 的最新资讯：\n\n`
    
    results.slice(0, maxResults).forEach((item, i) => {
      // 截断摘要，防止太长
      let content = item.content || '暂无摘要'
      if (content.length > 80) content = content.substring(0, 80) + '...'
      
      mdText += `- **[${item.title}]( ${item.url} )**\n  ${content}\n\n`
    })
    
    return mdText.trim()
  } catch (err) {
    console.error('[联网搜索] 请求失败:', err.message)
    return null
  }
}

// ================= 插件核心逻辑 =================
module.exports = {
  info: {
    name: '复合搜索助手',
    version: '1.2.0',
    desc: '支持天气查询和 SearXNG 联网搜索'
  },

  async beforeChat(messages) {
    if (!messages || messages.length === 0) return messages
    
    const lastMsg = messages[messages.length - 1]
    if (!lastMsg || lastMsg.role !== 'user') return messages

    let text = lastMsg.content.trim()

    if (text.startsWith('/websearch')) {
      const query = text.replace('/websearch', '').trim()
      if (query) {
        console.log(`\n🔍 [复合搜索] 触发联网搜索: ${query}`)
        const searchResult = await fetchSearxng(query)
        
        if (searchResult) {
          console.log(`✅ [复合搜索] 搜索成功，直接返回排版好的数据`)
          
          // 👈 核心修改：直接把排版好的 Markdown 丢给前端，跳过大模型！
          return {
            isDirectReply: true,
            content: searchResult
          }
        } else {
          console.log(`❌ [复合搜索] 搜索失败或无结果`)
          return {
            isDirectReply: true,
            content: `抱歉，没有搜到关于“${query}”的相关信息。请检查你的 SearXNG 服务是否正常启动。`
          }
        }
      }
    } 
    else if (/天气|几度|气温|温度|下雨|下雪|晴天/.test(text)) {
      // ... (天气逻辑保持之前的，完全没问题)
      let dateOffset = 0
      let dateDesc = '今天'
      if (text.includes('后天')) { dateOffset = 2; dateDesc = '后天'; text = text.replace('后天', '') }
      else if (text.includes('明天')) { dateOffset = 1; dateDesc = '明天'; text = text.replace('明天', '') }
      else if (text.includes('今天')) { dateOffset = 0; dateDesc = '今天'; text = text.replace('今天', '') }

      let cleanText = text.replace(/(几度|气温|温度|下雨|下雪|晴天|怎么样|的|吗|么|会|查|问|看看|天气)/g, '').trim()
      
      let city = cleanText
      let cityId = cityMap[city]
      let matchName = city
      
      if (!cityId && city.length >= 2) {
        const possibleKeys = Object.keys(cityMap).filter(k => k.includes(city))
        if (possibleKeys.length > 0) {
          const bestKey = possibleKeys.sort((a, b) => b.length - a.length)[0]
          cityId = cityMap[bestKey]
          matchName = bestKey
        } else {
          city = text.substring(0, 2)
          cityId = cityMap[city]
          if (cityId) matchName = city
        }
      }

      if (cityId) {
        console.log(`\n🔍 [复合搜索] 识别到天气查询: ${matchName}, ${dateDesc}`)
        const displayName = nameWithCity[matchName] || matchName
        const weatherResult = dateOffset === 0 
          ? await fetchTodayWeather(cityId) 
          : await fetchForecast(cityId, dateOffset)
          
        if (weatherResult) {
          console.log(`🌤️ [复合搜索] 抓取成功，直接返回: ${displayName} ${weatherResult}`)
          return {
            isDirectReply: true,
            content: `${displayName} ${weatherResult}`
          }
        }
      }
    }

    return messages
  }
}