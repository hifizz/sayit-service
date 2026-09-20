# SayIt Service

把自然口述变成用户真正想发送的文字，而不替用户回答问题、添加事实或改变意思。

SayIt 是一个 **personalized speech-to-writing backend**：以 Typeless 的公开可观察效果为产品参照，使用 Grok Voice Transcribe 2.0 转录，再完成保守润色、个人词典纠正和用户编辑反馈学习。首批接入场景是 ThreadChat 输入框。没有 macOS 客户端，也不依赖任何特定客户端。

> 当前是 v0.1 服务端实现。**自动化测试通过不等于已达到 Typeless 的真实效果。** 没有真实音频、API Key 和同音频人工盲测时，不发布准确率或 Typeless parity 的结论。Mock 模式仅原样回传文本，不伪装成语音识别。

## 核心链路

```text
音频 → Grok /v1/stt（个人 keyterm）
     → 一次上下文/词典感知的整理
     → 独立语义检查
     → 最多一次保守修复并复查
     → 不通过则回退原始转录

用户编辑本次口述片段 → 精确 diff → 分类 → 词典候选/生效规则/抽象风格
```

所有步骤都服从：保留否定、数字、单位、条件、需求细节和不确定程度；不回答用户、不扩写新需求；只有局部明确改口才替换旧表达。多个逻辑阶段合并在一次 rewrite 中，不意味着固定调用六次模型。

## 快速启动：不需要模型 Key

需要 Node.js 22+。功能开发在 `feat/typeless-parity-backend`，通过 PR 合并到 main。

```bash
git clone --branch feat/typeless-parity-backend https://github.com/hifizz/sayit-service.git
cd sayit-service
npm install
npm run setup
npm run dev
```

`setup` 只在 `.env` 不存在时创建文件，不覆盖已有配置。它生成随机服务令牌。开发默认使用内存，进程退出即丢失数据；持久化使用 PostgreSQL。

另开终端：

```bash
set -a; . ./.env; set +a
curl http://127.0.0.1:8787/v1/dictations/text \
  -H "Authorization: Bearer $SAYIT_SERVICE_TOKEN" \
  -H 'X-Sayit-User-Id: local-user' \
  -H 'Content-Type: application/json' \
  -d '{"raw_transcript":"先不要删除旧数据。","context":{"type":"ai_prompt","app":"threadchat"}}'
```

## 使用真实模型

修改本机 `.env`，**不要把 Key 写入 Git、Issue、PR、音频 manifest 或公开评测报告**：

```dotenv
SAYIT_MODE=live
XAI_API_KEY=你的密钥
```

ASR 使用 xAI；cleanup/rewrite 的当前 baseline 改为 `glm-5.3-flash`，通过 OpenAI-compatible 中转调用。仓库不会提交或猜测你的私有中转域名与 Key；在本机 `.env` 设置真实 `LLM_BASE_URL` 与 `LLM_API_KEY`：

```dotenv
SAYIT_MODE=live
XAI_API_KEY=你的_xAI_Key
LLM_BASE_URL=https://你的中转地址/v1
LLM_MODEL=glm-5.3-flash
LLM_API_KEY=你的中转_Key
```

如果 `glm-5.3-flash` 仍指向 xAI 地址，服务会在启动时明确报错，避免静默把模型发到错误 provider。真实账户权限、延迟与输出质量仍需实际调用验证。

```bash
set -a; . ./.env; set +a
curl http://127.0.0.1:8787/v1/dictations \
  -H "Authorization: Bearer $SAYIT_SERVICE_TOKEN" \
  -H 'X-Sayit-User-Id: local-user' \
  -H 'Idempotency-Key: recording-000001' \
  -F 'context={"type":"ai_prompt","app":"threadchat"}' \
  -F 'file=@./sample.m4a'
```

返回 `id`、`text`、`raw_transcript`、`output_sha256` 和 `meta.guard_status`。`fallback` 不是润色成功；调用端应保留提示或重试入口。相同 Idempotency-Key 与相同输入返回同一个结果；不同输入复用 Key 返回 409。

## 接口

除 `/health`、`/ready` 外，所有接口都要求服务令牌及可信用户身份头。

| 接口 | 作用 |
| --- | --- |
| `POST /v1/dictations` | multipart 音频转文字并整理 |
| `POST /v1/dictations/text` | 直接测试转录后的整理链路 |
| `GET /v1/dictations/:id` | 获取本人的保留记录 |
| `DELETE /v1/dictations/:id` | 删除记录及关联纠正样本 |
| `POST /v1/dictations/:id/feedback` | 原子处理最终编辑反馈 |
| `GET /v1/vocabulary` | 查询个人词典及候选词 |
| `POST /v1/vocabulary` | 手工添加或补充词条别名 |
| `DELETE /v1/vocabulary/:id` | 屏蔽词条，防止自动重新学回 |
| `GET/PATCH/DELETE /v1/personalization` | 查询、开关、重置个性化数据 |
| `DELETE /v1/me/data` | 删除该用户所有服务端数据 |

完整请求示例与归因约定见 [ThreadChat 接入](docs/threadchat-integration.md)。`X-Sayit-User-Id` 只能由持有服务密钥的可信后端根据登录态设置；**不能把服务密钥暴露给浏览器，让浏览器自行指定用户**。

## 测试与评测

```bash
npm run typecheck
npm test
npm run build
npm run eval -- --mode mock --out reports/mock

# 设置好 Key 后：真实模型处理合成文本测试集
npm run eval -- --mode live --limit 32 --out reports/live-text

# 真实音频：复制示例 manifest 到 gitignored 私有目录，填入真实路径及人工参考
npm run eval -- --mode live --dataset evaluation/private/manifest.jsonl --out reports/live-audio

# 同输入 SHA256 的 Typeless 输出与 SayIt 输出形成盲测包
npm run eval:parity -- --left reports/live-audio/report.json --right evaluation/private/typeless.json --out reports/parity
```

GitHub CI 执行类型检查、单元/API/provider 合约测试、**真实 PostgreSQL 集成测试**、迁移重跑、构建、mock 评测框架、编译后 HTTP 启动及 Docker 构建。手动 live workflow 只测试公开合成文本，且必须显式触发；不会在 PR 中使用模型 Key。

报告区分参考文本编辑距离、实际用户编辑成本、字面约束检查和人工语义判定。没有测量的数据为 `null`，不伪造为 0。详见 [评测规范](docs/evaluation.md)。

## 持久化与部署

```bash
# 在 .env 中填 PostgreSQL 地址
npm run db:migrate
npm run build
npm start

# Docker Compose：先在 .env 中设置独立随机的十六进制 POSTGRES_PASSWORD
# 然后启动数据库与 API；入口只绑定本机 8787
docker compose up --build
```

数据库迁移有版本与校验和，支持重复运行。生产模式禁止内存存储。服务默认不持久化音频；为归因与反馈暂存文本/上下文，默认 168 小时，启动及每小时清理。词典、屏蔽记录及抽象风格保留到主动重置/删除。**这不是 Typeless 所宣称的云端内容零留存实现**，见 [部署与隐私](docs/runbook.md)。

## 规范与事实源

- [项目约束与路线](openspec/project.md)
- [听写与纠正策略](openspec/specs/dictation/spec.md)
- [反馈学习规范](openspec/specs/feedback/spec.md)
- [架构与边界](docs/architecture.md)
- [ThreadChat 接入](docs/threadchat-integration.md)
- [评测协议](docs/evaluation.md)
- [中英混杂评测数据集](docs/code-switching-datasets.md)
- [部署、Key 与数据保留](docs/runbook.md)
- [外部资料及验证边界](docs/sources.md)

不包含原生客户端、用户级微调、自动读取任意应用、实时 WebSocket 转录或未经验证的 Typeless 服务端内部实现。
