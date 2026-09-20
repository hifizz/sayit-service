# 部署、凭据与运维

## 环境变量

`SAYIT_MODE=mock|live`：mock 仅用于文本链路连通，不接真实音频，不伪造质量。`SAYIT_SERVICE_TOKEN`：至少 32 字符的独立随机服务令牌。`XAI_API_KEY`：ASR；`LLM_API_KEY` 留空时复用 xAI Key。`LLM_BASE_URL`/`LLM_MODEL` 可换成可信的 compatible provider，不要把 xAI Key 发给不可信中转。

`DATABASE_URL`：PostgreSQL。production 必须设置；development 未设置使用内存。`RETENTION_HOURS=168`：暂存文本保留时长。`MAX_AUDIO_BYTES=26214400`：上传大小上限，不等于音频计费时长限制。`MAX_REQUESTS_PER_MINUTE=60` 和 `MAX_CONCURRENT=16` 是进程内保护，不是分布式配额。

不要把真实 Key 直接写进 curl 命令、shell history 或公开聊天。用 `.env`（权限 0600）或部署系统的 secret 配置。仓库忽略 `.env` 和私人音频目录；部署前也要检查 Git 状态，不能只靠忽略规则代替审查。

## GitHub Actions

无 Key 的 CI 自动运行。要手动跑公开合成文本的真实模型评测，在仓库 Settings → Secrets and variables → Actions 添加 secret `XAI_API_KEY`，可选 `LLM_API_KEY`。`LLM_BASE_URL` 作为 repository variable；模型名由手动 workflow input 指定。Live workflow 只在显式 workflow_dispatch 时调用真实模型，存在费用。

工作流位于默认分支后可在 Actions UI 选择。真实音频不放进公开仓库，也不靠不受信任的外部 URL 拉取；使用 `evaluation/private/manifest.jsonl` 在受控环境运行。报告中有转录/参考文字时同样需要保密。artifact 保留时长为 7 天。

## 首次部署

安装依赖，`npm run setup`，配置 Key 与 PostgreSQL，执行 `npm run db:migrate`，再 build/start。迁移自动记录 checksum；已经执行的迁移不得修改，后续新增文件。测试数据库与生产数据库必须隔离。

Docker Compose 在本机 127.0.0.1:8787 暴露 API，数据库不映射宿主机端口。设置随机十六进制 `POSTGRES_PASSWORD`，以避免未编码特殊字符破坏 DATABASE_URL。公网必须置于 HTTPS 网关后，配置请求/上传超时、认证、速率与流量监控；不要直接把无 TLS 的 8787 暴露公网。

## 数据保留和删除

原始音频不写本服务数据库或日志；音频会发给 ASR provider，文本及必要上下文会发给 cleanup provider，供应商保留策略需独立核实。

原始转录、输出、必要上下文和 feedback 回执默认保存 168 小时，以支持归因和重试。启动与每小时 purge 删除过期 dictations，关联 corrections 级联删除。词典（也可能包含私人姓名）、屏蔽词条、抽象风格和个性化开关长期保存到用户主动删除/重置。关闭个性化不自动清空历史；需要删除时调用对应 API。

删除后仍可能存在数据库备份和 provider 记录。部署者需要配置磁盘/备份加密、备份保留、访问权限和日志设施。这里不宣称与 Typeless 的零云端内容留存相同。

## 异常

400：请求参数或 JSON 不合法；401：服务令牌不合法；404：不存在或不属于该用户；409：幂等键冲突、用户已有写请求、过期输出反馈或反馈已定稿；413：录音过大；415：不支持的输入；429：本地限流；502/503/504：provider 或服务不可用/超时。不会返回上游原始错误体或凭据。

返回 text 且 guard_status=fallback 表示保留了原始转录，是显式降级，不代表优化成功。应记录次数并纳入评测。事务尚未提交时进程崩溃，不保证 provider 请求不被再次计费；不要把 API 幂等宣传成模型账单 exactly-once。
