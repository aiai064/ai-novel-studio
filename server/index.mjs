import http from 'node:http'
import crypto from 'node:crypto'
import { createServer as createViteServer } from 'vite'

const port = Number(process.env.PORT || 5174)
const responseCache = new Map()
const cacheTtlMs = 24 * 60 * 60 * 1000
const maxCacheEntries = 120

function normalizeEndpoint(endpoint) {
  const base = String(endpoint || 'https://api.deepseek.com').replace(/\/+$/, '')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

async function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

async function handleDeepSeek(req, res) {
  try {
    const body = await readJson(req)
    const apiKey = String(body.apiKey || '')
    if (!apiKey) {
      await sendJson(res, 400, { error: '缺少 DeepSeek API Key。' })
      return
    }

    const cacheKey = makeCacheKey(body)
    const cached = body.cacheEnabled !== false ? responseCache.get(cacheKey) : null
    if (cached && Date.now() - cached.createdAt < cacheTtlMs) {
      await sendJson(res, 200, { ...cached.data, cacheHit: true })
      return
    }

    const upstream = await fetch(normalizeEndpoint(body.endpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: body.model || 'deepseek-v4-flash',
        messages: body.messages || [],
        temperature: 0.82,
        max_tokens: Number(body.maxTokens || 12000),
        thinking: { type: body.thinking === true ? 'enabled' : 'disabled' },
        response_format: { type: 'json_object' },
      }),
    })

    const data = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      await sendJson(res, upstream.status, {
        error: data?.error?.message || data?.message || `DeepSeek 请求失败：${upstream.status}`,
      })
      return
    }

    const payload = {
      content: data?.choices?.[0]?.message?.content || '',
      usage: data?.usage,
      cacheHit: false,
    }

    if (body.cacheEnabled !== false) {
      responseCache.set(cacheKey, { createdAt: Date.now(), data: payload })
      trimCache()
    }

    await sendJson(res, 200, payload)
  } catch (error) {
    await sendJson(res, 500, { error: error instanceof Error ? error.message : '服务器代理异常。' })
  }
}

function makeCacheKey(body) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        endpoint: normalizeEndpoint(body.endpoint),
        model: body.model || 'deepseek-v4-flash',
        maxTokens: Number(body.maxTokens || 12000),
        thinking: body.thinking === true,
        messages: body.messages || [],
      }),
    )
    .digest('hex')
}

function trimCache() {
  while (responseCache.size > maxCacheEntries) {
    const oldest = responseCache.keys().next().value
    responseCache.delete(oldest)
  }
}

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: 'spa',
})

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/deepseek/chat') {
    await handleDeepSeek(req, res)
    return
  }
  vite.middlewares(req, res)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`AI 小说工作台已启动：http://127.0.0.1:${port}`)
})
