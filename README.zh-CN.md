# SayIt Service

[English](README.md) · **中文**

[![CI](https://github.com/hifizz/sayit-service/actions/workflows/ci.yml/badge.svg)](https://github.com/hifizz/sayit-service/actions/workflows/ci.yml)

一个服务端语音写作 API：把口述音频整理成可编辑文字，同时保留说话者原意。

SayIt 使用 xAI Grok Voice Transcribe 2.0 转录音频，再通过可配置的 OpenAI-compatible LLM 做保守整理。它支持个人术语、精确片段反馈，并在改写不可信时明确回退。

> **当前状态：** v0.1 服务端。工程链路已有测试，但尚未通过同音频人工盲测证明真实场景准确率或 Typeless parity。

> **许可证：** [MIT](LICENSE)，详见[许可证](#许可证)。

## 功能概览

| 能力 | 行为 |
| --- | --- |
| 语音转录 | 把上传的音频发送给 xAI `grok-voice-transcribe-2.0` |
| 保留语义的整理 | 删除口癖和重复，改善语法及格式，同时保留否定、数字、条件、范围和不确定程度 |
| 个人词典 | 将 active 标准词作为 xAI keyterm，并在整理阶段使用已确认别名 |
| 反馈学习 | 仅从能够精确归因到本次口述片段的编辑中学习，并保证最终反馈幂等 |
| 语义复查 | 检查改写，最多尝试一次保守修复；复查失败时回退原始转录 |
| 用户隔离 | 按可信后端认证的用户隔离记录和个性化数据 |

```text
音频
  → xAI 语音转文字 + keyterm
  → 结合词典的改写
  → 语义复查
  → 保守修复或回退原始转录
  → 可编辑草稿
```

SayIt 只表达说话者原本想写的内容，不回答说话者提出的问题，也不添加没有口述的事实或要求。

## 快速开始

需要 Node.js 22+ 和 pnpm（`corepack enable`）。

```bash
git clone https://github.com/hifizz/sayit-service.git
cd sayit-service
pnpm install
pnpm run setup
pnpm run dev
```

默认的 `mock` 模式不需要模型 Key。它用于验证带鉴权的文本链路，并且会刻意原样返回文字，不模拟智能整理或语音识别。

另开一个终端：

```bash
set -a; . ./.env; set +a

curl http://127.0.0.1:8787/v1/dictations/text \
  -H "Authorization: Bearer $SAYIT_SERVICE_TOKEN" \
  -H "X-Sayit-User-Id: local-user" \
  -H "Content-Type: application/json" \
  -d '{"raw_transcript":"先保留现有数据。","context":{"type":"ai_prompt","app":"threadchat"}}'
```

`pnpm run setup` 只在 `.env` 不存在时创建私有配置。未设置 `DATABASE_URL` 时，开发环境使用重启即清空的内存存储。

### 本地 Demo 页（可选）

基于 [ElevenLabs UI](https://ui.elevenlabs.io) 组件的最小 Web Demo，可测试文本与音频听写全链路：

```bash
pnpm demo:install   # 首次：安装 demo 依赖
pnpm run dev        # 终端 1：启动服务
pnpm demo           # 终端 2：Demo 页 http://localhost:5173
```

在连接设置里粘贴 `.env` 中的 `SAYIT_SERVICE_TOKEN`；Token 仅保留在浏览器内存。Demo 用于验证链路连通（录音/上传音频、提交原始转写、查看 `guard_status` 与元数据），不构成质量或 Typeless parity 评测。

## 真实模型

音频转录使用 xAI。启用真实链路：

```dotenv
SAYIT_MODE=live
XAI_API_KEY=your-xai-key
```

整理默认使用 xAI `grok-4.6`，也可以配置单独的 OpenAI-compatible provider。项目当前使用的 DeepSeek 配置如下：

```dotenv
LLM_API_KEY=your-deepseek-key
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-flash
LLM_JSON_MODE=json_object
```

当 LLM 和 xAI 的域名不同时，SayIt 强制要求单独设置 `LLM_API_KEY`，不会把 xAI Key 转发给其他 provider。

语义复查默认开启。设置 `SEMANTIC_GUARD_ENABLED=false` 会跳过独立复查，并返回 `guard_status=disabled`。这会减少模型调用等待时间，但输出没有通过 SayIt 的语义审查。

上传音频：

```bash
curl http://127.0.0.1:8787/v1/dictations \
  -H "Authorization: Bearer $SAYIT_SERVICE_TOKEN" \
  -H "X-Sayit-User-Id: local-user" \
  -H "Idempotency-Key: recording-000001" \
  -F 'context={"type":"ai_prompt","app":"threadchat"}' \
  -F 'key_terms=["ThreadChat","E2B"]' \
  -F "file=@./sample.ogg"
```

响应包含最终 `text`、`raw_transcript`、`output_sha256`、听写 `id` 和处理元数据。`guard_status=fallback` 表示返回的是原始转录，这是明确降级，不代表改写成功。

## API

除 `/health` 和 `/ready` 外，所有接口都要求：

- `Authorization: Bearer <SAYIT_SERVICE_TOKEN>`
- `X-Sayit-User-Id: <可信的已认证用户 ID>`

| 接口 | 用途 |
| --- | --- |
| `POST /v1/dictations` | 转录并整理上传的音频文件 |
| `POST /v1/dictations/text` | 使用给定文字测试 ASR 之后的整理链路 |
| `GET /v1/dictations/:id` | 读取当前用户仍在保留期内的结果 |
| `DELETE /v1/dictations/:id` | 删除结果及其关联纠正证据 |
| `POST /v1/dictations/:id/feedback` | 原子定稿精确片段的编辑反馈 |
| `GET /v1/vocabulary` | 查询 active 和 candidate 词条 |
| `POST /v1/vocabulary` | 添加手工标准词及别名 |
| `DELETE /v1/vocabulary/:id` | 屏蔽词条，避免再次自动学回 |
| `GET/PATCH/DELETE /v1/personalization` | 查询、开关或重置个性化 |
| `DELETE /v1/me/data` | 删除当前认证用户的全部服务端数据 |

请求格式和反馈归因规则参见 [ThreadChat 接入](docs/threadchat-integration.md)。

## 集成方式

```text
浏览器录音器/编辑器
        ↓ 已认证 session
可信应用后端
        ↓ 服务令牌 + 可信用户 ID
SayIt API
        ↓ provider 凭据始终留在服务端
xAI STT + 已配置的整理 LLM
```

浏览器不得获得 `SAYIT_SERVICE_TOKEN` 或 provider Key。可信应用后端必须从认证 session 得到 `X-Sayit-User-Id`，不能接受浏览器任意指定的用户 ID。

SayIt 返回可编辑草稿，不会自动发送消息。

## 安全与隐私

- 改写必须保留否定、数字事实、不确定性、条件和范围。
- 语义检查服务失败时，不能采用未经检查的改写。
- 服务不接受任意音频 URL，只接受直接上传的音频文件。
- 音频只在请求内存中处理，不写入 SayIt 数据库或日志。
- 原始转录、输出、必要上下文和反馈回执默认保留 168 小时。
- 词典和抽象风格偏好会保留到用户主动重置或删除。
- 音频和文字会发送给已配置的模型 provider；其数据保留策略需要单独评估。
- Git 已忽略 `.env`、常见音频格式、报告、artifacts 和 `evaluation/private/`。其他私人转录或凭据也不得进入提交。

完整运维边界参见[部署、凭据与数据保留](docs/runbook.md)。

## 验证

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run eval --mode mock --out reports/mock
```

CI 还会使用隔离的 PostgreSQL 服务运行迁移、provider 合约测试、编译后 HTTP 冒烟测试和 Docker 构建。

Mock 评测只验证评测框架。真实模型质量需要私人音频、人工逐字参考、期望最终文字和人工语义判定。Typeless 对比需要使用相同源音频并进行人工盲测。详见[评测协议](docs/evaluation.md)和[验证记录](docs/validation.md)。

## 部署

生产模式必须使用 PostgreSQL。

```bash
pnpm run db:migrate
pnpm run build
pnpm start
```

本地部署也可以使用 Docker Compose：

```bash
docker compose up --build
```

生产环境应放在 HTTPS 网关之后，并根据部署环境配置数据库备份、provider 保留策略、请求超时和共享限流。

## 文档

- [架构与工程边界](docs/architecture.md)
- [项目约束与路线](openspec/project.md)
- [ThreadChat 接入](docs/threadchat-integration.md)
- [评测协议](docs/evaluation.md)
- [部署、凭据与数据保留](docs/runbook.md)
- [听写与纠正规范](openspec/specs/dictation/spec.md)
- [反馈与个性化规范](openspec/specs/feedback/spec.md)
- [外部资料与核实范围](docs/sources.md)

## 当前限制

- 音频转录使用文件批处理，尚未实现实时 WebSocket 转录。
- 仓库包含服务端和服务端集成示例，不包含原生桌面客户端。
- 语义复查是概率性防线，不能证明语义完全等价。
- 限流和全局并发闸门仅在当前进程内生效。
- 如果进程在 provider 已响应、数据库事务提交前退出，provider 调用无法保证账单 exactly-once。
- 未完成必要的真实数据评测前，不声明准确率、延迟 SLA、个性化提升或 Typeless parity。

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。
