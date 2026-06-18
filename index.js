require('dotenv').config()

const express = require('express')
const axios = require('axios')

const app = express()
app.use(express.json())

const FEISHU_ROBOT_APP_ID = process.env.FEISHU_ROBOT_APP_ID
const FEISHU_ROBOT_APP_SECRET = process.env.FEISHU_ROBOT_APP_SECRET

if (!FEISHU_ROBOT_APP_ID || !FEISHU_ROBOT_APP_SECRET) {
  console.error('错误：缺少飞书机器人密钥，请在 .env 文件中配置 FEISHU_ROBOT_APP_ID 和 FEISHU_ROBOT_APP_SECRET')
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

// ========== 业务模拟 ==========

async function callStockApi(stockCode) {
  // TODO: 替换为真实的 API 调用
  // const res = await axios.post('https://your-api.com/stock', {
  //   stock_code: stockCode,
  // })
  // return res.data

  console.log(`[模拟] 调用股票 API，stock_code: ${stockCode}`)
  return { success: true, data: { stock_code: stockCode, price: '模拟价格' } }
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

    // 3.3 提取全文
    const text = JSON.parse(msg.content).text

    // 3.4 从文本中提取股票
    const stockCode = text

    if (!stockCode) {
      await sendText(msg.chat_id, '未检测到股票信息')
      return
    }

    // 4. 先回中间态
    await sendText(msg.chat_id, '正在处理，请等待推送…')

    // 5. 调用业务 API
    try {
      const result = await callStockApi(stockCode)
      await sendText(msg.chat_id, `处理完成：\n${JSON.stringify(result, null, 2)}`)
    } catch (error) {
      console.error(error)
      await sendText(msg.chat_id, '业务处理失败，请稍后重试')
    }
  })
})

// ========== 启动 ==========

const PORT = 7007
const HOST = '0.0.0.0'
app.listen(PORT, HOST, () => {
  console.log(`Stock bot server running on http://localhost:${PORT}`)
})