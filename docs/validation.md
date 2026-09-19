# 验证记录与交付边界

## 已完成的一轮工程验证

代码提交 `99a09c59a60f4497be9d2285db6e1dd0eb1e32a8` 的 GitHub Actions run：
https://github.com/hifizz/sayit-service/actions/runs/35472121510

JUnit 实测：92 项测试通过，0 失败，0 错误，0 跳过。其中 API 17、feedback 14、policy/metrics 46、真实 PostgreSQL 4、provider/config 11。类型检查、迁移连续执行两次、生产构建、编译后 HTTP 启动、Docker 构建均成功。之后的补充边界测试以 PR 最新 CI 为准。

32 条公开合成文本已经跑通 mock 评测管线，32/32 请求成功。**这仅是框架连通验证，不是语音识别或 Typeless 效果评分**。不把 mock 的逐字一致率、约束检查率或毫秒级耗时宣传为真实模型指标。

## 尚未验证

- 真实 xAI ASR 调用：需要有权限的 API Key 和录音。
- 真实 cleanup/guard 的中文及中英混合质量、延迟和成本。
- 用户长期编辑后的个性化提升。
- 与 Typeless 的相同音频盲测比较。
- 公网生产部署、多副本共享限流和承载上限。

## 默认模型设置

xAI 原生 `grok-4.6`/`grok-4.5` 在本服务中显式使用 `reasoning_effort=low`，避免它们默认 high 带来的额外推理延迟；其他 compatible model 不自动收到这个厂商参数。选择 low 不代表已经测得任何具体延迟或质量优势。依据：
https://docs.x.ai/developers/model-capabilities/text/reasoning

## 修订词条

POST 同 canonical/scope 可以补充 aliases。需要去掉一个错误 alias 时，先 DELETE 该词条，再 POST 正确的 canonical/aliases；显式恢复只采用这次给定的 aliases，不恢复已删除的错误映射。删除本身保留 blocked 状态，自动学习无法取消屏蔽。
