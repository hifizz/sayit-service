# 架构与工程边界

## 模块

`src/app.ts` 定义鉴权、限流、输入验证和 HTTP；`providers/stt.ts` 只实现 xAI batch；`providers/llm.ts` 实现可配置 OpenAI-compatible JSON chat；`domain/dictation-service.ts` 编排改写/审核/修复；`domain/feedback-service.ts` 处理对齐与学习；`domain/personalization.ts` 处理词典范围、词条筛选和相关纠正检索；`storage/*` 提供内存测试适配与 PostgreSQL 实现。

`prompts.ts` 是版本化策略，导出 policy version 和内容 SHA256。模型输出不是可信类型断言：domain 中再次使用 Zod 验证。

## 在线路径

一次普通非空口述：ASR 1 次，rewrite 1 次，必要时 guard 1 次。如果第一次 guard 判定不安全，最多再 rewrite+guard 各 1 次。literal identical 免额外审核；审核服务不可用直接回退。所有 provider 有超时，HTTP 创建路径有总预算，不自动重试收费 POST。

反馈路径另行执行：读取原输出 → 校验 hash 和回执 → server diff → 模型分类 → 硬规则过滤 → 原子写入；仅符合纯展示修改的风格候选才额外做等价审核。反馈失败不影响已经得到的听写结果，调用者可用同一个请求安全重试。

## 数据与事务

PostgreSQL 保留 dictations、vocabulary、corrections、style_profiles、personalization_settings，迁移另有 schema_migrations。所有业务读写均以可信 user id 限定。

v0.1 用 PostgreSQL 事务 advisory lock 按用户串行写入，保证多个服务进程也不会重复学习或重复创建同一个幂等请求。锁等待上限 2 秒，冲突返回 `user_request_in_progress`。当前实现会在远程模型调用期间持有该用户的事务及连接：简单可靠，但不是高吞吐最终架构。单实例默认并发上限 16，连接池 20。多用户可并发，同一用户长请求不能无限排队。

内存适配仅用于开发和确定性测试，用快照提交/回滚保持相同原子语义，重启不保留数据。生产环境强制 PostgreSQL。

## 安全与隐私

入口是 server-to-server 的服务令牌；用户头来自 ThreadChat 已验证的 session。不要让浏览器持有服务令牌。无任意 URL 下载，减少 SSRF 面。multipart 音频大小、字段、文件数有限；原始音频只在请求内存中使用，不写日志/数据库。

HTTP 日志不记录请求正文、音频、转录、模型请求响应或凭据，错误只暴露稳定错误码。数据库、备份和第三方 provider 的保留行为仍需部署者自行配置和核实，不能由不落音频库推导出全链路零留存。

文本和上下文默认保留 168 小时，读取和定期清理需要一致。相关 correction 原文随 dictation 删除级联清理。词典本身也可能包含私人名词，所以它仍然属于用户数据。

## 当前边界

- 无实时 WebSocket，不把浏览器 WebM 片段伪装成 Opus raw packets。
- 无任务队列恢复和取消协议；进程在收费请求后、提交前崩溃可能需要重试并再次付费。幂等键只能保证已提交结果的重放，不保证 provider 账单 exactly-once。
- 限流和全局并发闸门当前是进程内；多副本上线前需网关/共享限额。
- 不支持已经 finalized 的反馈修订；冲突返回 409，可通过词典管理纠正。
- Unicode diff 有计算预算，长段复杂编辑会跳过自动学习。
- JSON LLM auditor 是概率性防线，不是语义等价的证明。没有真实评测不能保证 Typeless 水平或给出质量/延迟 SLA。
- 词典 CRUD 和评分脚本需继续以真实反馈校准，不直接启动模型微调。
