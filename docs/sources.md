# 外部参照与核实范围

核实日期：2026-09-20。以下是公开产品/接口说明，不是对闭源服务端的逆向结果。

- xAI announcement: https://x.ai/news/grok-voice-transcribe-2
- xAI Speech to Text API: https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
- Typeless Dictionary: https://www.typeless.com/help/quickstart/history-and-dictionary
- Typeless Personalization: https://www.typeless.com/help/quickstart/personalization

xAI 说明的实际 REST 接口是 `/v1/stt`；repeat `keyterm`，最多 100 个、单词条最多 50 个字符；file 在 multipart 最后；filler_words 控制是否保留口癖；format 是带语言前提的数值书面化。实现固定 2.0 model slug，避免“默认模型未来切换”带来的歧义。

Typeless 公开说明手工/自动词典以及从用户纠正学习拼写，公开描述抽象写作偏好与隐私策略。它没有在这些资料中公开我们能够核实的服务端代码、模型、提示词、置信度阈值、学习次数或内部评测数据。因此本仓库阈值、数据库和流水线都是自己的可测试设计，不冒称复现内部架构。

此前讨论中提及的第三方开源客户端/网关只作为调研线索；本实现不依赖未经代码核实的“已有后端算法”，没有复制这些仓库代码或其许可证内容。
