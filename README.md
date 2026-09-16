# LLM Relay & Management Platform

统一大模型 API 中转网关（MySQL 8 + Redis）：OpenAI 兼容接口 + 多渠道负载均衡 + 多维限流 + 熔断 + 优先级排队 + 会话管理 + 内容审计 + 可视化后台。

## 快速开始

```bash
cp .env.example .env            # 修改 ADMIN_JWT_SECRET / API_KEY_ENCRYPTION_KEY
docker compose up -d mysql redis
npm install
npx prisma migrate dev --name init
npm run db:seed                 # 输出 admin 密码与首个访问令牌
npm run dev                     # Web + API  http://localhost:3000/admin
npm run worker:dev              # 任务调度层（异步队列 / 日志入库 / 统计汇总）
```

生产：`docker compose up -d --build`（web + 2 个 worker 副本）。

## 调用示例

```bash
# 非流式
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-..." -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'

# 流式（X-Queue-Progress: 1 时排队期间推送 event: queue 帧）
curl -N http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-..." -H "Content-Type: application/json" -H "X-Queue-Progress: 1" \
  -d '{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"hi"}]}'

# 异步模式：入 BullMQ 队列，返回 job_id，SSE 轮询进度
curl -H "X-Async: true" ... -> {"job_id":"...","poll":"/v1/jobs/<id>"}
curl -N -H "Accept: text/event-stream" -H "Authorization: Bearer sk-..." http://localhost:3000/v1/jobs/<id>

# 会话（自动拼接上下文）
curl -X POST http://localhost:3000/v1/sessions -H "Authorization: Bearer sk-..." \
  -d '{"model":"gpt-4o","system_prompt":"You are helpful."}'
# 然后在 chat completions 中传 "session_id": "<id>"
```

> 配合 OpenAI SDK：`baseURL = http://localhost:3000/v1`（`next.config.mjs` 已将 `/v1/*` 重写到 `/api/v1/*`）。

## 架构

```
Client ──► /api/v1/chat/completions (Next.js Route Handler, Node runtime)
            │ auth(Bearer, Redis cache) → zod 校验 → 令牌 RPM/TPM(令牌桶 Lua) → 输入审计 → 会话上下文
            │
            ├─► 并发闸门 acquireSlot()  ── Redis ZSET 优先级等待室 + pub/sub 唤醒 + 超时/断连清理
            │      （流式请求排队期间通过 SSE 注释/事件推送位置与 ETA）
            │
            ├─► Relay Core  relayComplete / relayStream
            │      selectUpstream(): 路由缓存 → 优先级分组 → 加权随机 → Key 平滑轮询
            │                        → 熔断状态检查 → 渠道/Key RPM/TPM
            │      providerFor(): OpenAI 兼容 | Anthropic | Gemini  → 统一输出 OpenAI chunk 格式
            │      失败 → 记录熔断 / 自动禁用失效 Key → 换渠道重试（流式仅在首字节前）
            │
            └─► enqueueLog() → BullMQ `logs` → Worker 写 RequestLog / 配额累加 / 会话落库
                X-Async → BullMQ `relay` → Worker 执行（同样经过并发闸门） → GET /v1/jobs/:id
Worker: `stats` 队列每 5 分钟汇总 UsageStatHourly
Admin:  /admin (JWT cookie, edge middleware 保护) 渠道 / 令牌 / 日志 / 实时监控
```

## 目录结构

```
prisma/schema.prisma          数据模型
src/middleware.ts             Edge 中间件：request-id、后台鉴权
src/lib/
  env.ts logger.ts prisma.ts redis.ts crypto.ts errors.ts http.ts
  auth.ts                     Bearer 鉴权（Redis 缓存）+ 管理员 JWT
  ratelimit/token-bucket.ts   Redis Lua 令牌桶
  ratelimit/index.ts          令牌级 / 渠道级 / Key 级 RPM、TPM
  circuit-breaker.ts          渠道熔断（closed/open/half-open）
  queue/concurrency.ts        全局并发闸门 + 优先级等待室（流式友好）
  queue/index.ts              BullMQ 队列定义
  relay/types.ts              OpenAI 兼容请求/响应类型（zod）
  relay/selector.ts           渠道选择、负载均衡、Key 轮询、自动禁用
  relay/engine.ts             转发引擎：参数模板、重试、故障转移、流式聚合
  relay/providers/*           OpenAI / Anthropic / Gemini 适配器 + SSE 解析
  relay/tokens.ts             tiktoken 计数
  audit/index.ts              敏感词审计（含流式窗口过滤）
  session.ts                  会话上下文拼接与落库
  stats.ts                    仪表盘统计
src/worker/                   BullMQ 消费者（relay / logs / stats）
src/app/api/v1/               chat/completions, models, jobs/[id], sessions
src/app/api/admin/            login, channels, tokens, stats
src/app/admin/                后台页面；src/components/admin 组件；src/components/ui 基础组件
```

## 关键环境变量

见 `.env.example`。`GLOBAL_MAX_CONCURRENCY` 控制并发上限，`QUEUE_MAX_WAIT_SECONDS` 为最长排队时间，`CIRCUIT_FAILURE_THRESHOLD/CIRCUIT_OPEN_SECONDS` 控制熔断。
