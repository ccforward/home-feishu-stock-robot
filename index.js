require('dotenv').config()

const express = require('express')
const axios = require('axios')

const app = express()
app.use(express.json())

const FEISHU_ROBOT_APP_ID = process.env.FEISHU_ROBOT_APP_ID
const FEISHU_ROBOT_APP_SECRET = process.env.FEISHU_ROBOT_APP_SECRET
const API_STOCK_PATH = process.env.API_STOCK_PATH

if (!FEISHU_ROBOT_APP_ID || !FEISHU_ROBOT_APP_SECRET) {
  console.error('错误：缺少飞书机器人密钥，请在 .env 文件中配置 FEISHU_ROBOT_APP_ID 和 FEISHU_ROBOT_APP_SECRET')
  process.exit(1)
}

if (!API_STOCK_PATH) {
  console.error('错误：缺少股票 API 地址，请在 .env 文件中配置 API_STOCK_PATH')
  process.exit(1)
}

// ========== 飞书工具函数 ==========

async function getTenantToken() {
  const res = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/',
    { app_id: FEISHU_ROBOT_APP_ID, app_secret: FEISHU_ROBOT_APP_SECRET }
  )
  return res.data.tenant_access_token
}

async function sendText(chatId, text) {
  const token = await getTenantToken()
  try {
    await axios({
      method: 'POST',
      url: 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    })
  } catch (error) {
    console.log(error.response?.data)
    throw error
  }
}

// ========== 业务：调用股票 API（fire-and-forget）==========

function callStockApi(stockCode) {
  axios
    .post(API_STOCK_PATH, { stock_code: stockCode })
    .then(() => {
      console.log(`[成功] 已推送 stock_code: ${stockCode}`)
    })
    .catch((err) => {
      console.error(`[失败] 推送 stock_code: ${stockCode} 出错:`, err.message)
    })
}

app.get('/api/stock-tobot', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

// ========== 飞书 Webhook 路由 ==========

app.post('/api/stock-tobot', async (req, res) => {
  const json = req.body
  console.log(json)
  if (!json) {
    return res.status(200).send({ code: 0 })
  }

  // 1. URL 校验探针（飞书验证回调地址时必须返回 challenge）
  const challenge = json.event?.challenge ?? json.challenge
  if (challenge) {
    return res.status(200).send({ challenge })
  }

  // 2. 先回 200，避免飞书超时
  res.status(200).send({ code: 0 })

  // 3. 真正的业务放到下一轮事件循环
  setImmediate(async () => {
    // 3.1 只处理文本消息
    if (json.header?.event_type !== 'im.message.receive_v1') return

    const msg = json.event.message
    if (msg.message_type !== 'text') return

    // 3.2 必须 @机器人
    const mentions = msg.mentions || []
    if (!mentions.some((m) => m.key === '@_user_1')) return

    // 3.3 提取全文并清理 @机器人 的 mention 文本
    let text = JSON.parse(msg.content).text

    // 移除所有 mention 标记（飞书消息中 @某人 会显示为 @_user_X 格式）
    mentions.forEach((m) => {
      if (m.key) {
        const escapedKey = m.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp('\\s*' + escapedKey + '\\s*', 'g')
        text = text.replace(regex, ' ')
      }
    })

    // 清理多余空格并 trim
    text = text.replace(/\s+/g, ' ').trim()

    // 3.4 提取股票代码
    const stockCode = text

    if (!stockCode) {
      await sendText(msg.chat_id, '未检测到股票信息')
      return
    }

    // 4. 先回中间态
    await sendText(msg.chat_id, `正在调用AI使劲儿分析 ${stockCode} ，请等待推送...`)

    // 5. 调用业务 API（fire-and-forget，不等待结果）
    callStockApi(stockCode)
  })
})

// ========== 启动 ==========

const PORT = process.env.PORT || 7007
const HOST = '0.0.0.0'

app.listen(PORT, HOST, () => {
  console.log(`Stock bot server running on http://${HOST}:${PORT}`)
})