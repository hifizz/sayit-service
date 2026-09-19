# ThreadChat 第一批接入

## 信任边界

```text
浏览器录音/输入框 → ThreadChat 后端（验证 session） → SayIt API → 模型 provider
                       ↓ 根据 session.user.id 设置身份头
```

只有 ThreadChat 后端保存 SAYIT_SERVICE_TOKEN。用户身份不能从浏览器 body.user_id 原样透传。初次接入不需要修改 SayIt 客户端架构；本仓库仅提供 API 和后端调用示例，不声称已经修改 ThreadChat 仓库。

## 上传录音

后端转发 `POST /v1/dictations`，HTTP header 为 Authorization、X-Sayit-User-Id 和一个本次录音稳定的 Idempotency-Key。multipart 使用 file、context、可选 key_terms/language。默认 context：

```json
{"type":"ai_prompt","app":"threadchat","projectId":"project_123"}
```

只发送必要且已获用户许可的 surroundingText，不要把整个聊天历史、密钥或无关文档塞进上下文。

返回后保存 `dictation.id`、`output_sha256` 和 `text`，把 text 作为**可编辑草稿**插入，不自动发送。guard_status=fallback 时可显示轻提示，用户仍可直接编辑原始转录。

## 编辑归因：不能直接回传整条 submitted_text

每次口述在编辑器里形成一个被跟踪的 range/segment。支持在已有草稿中插入、连续多次口述、删除片段及撤销。编辑器 transaction 映射应更新对应 range；最后发送时，为每个仍能可靠归因的 dictation 单独取它的最终文本。

```json
{
  "event_id":"a05c0020-fd29-4b57-b82a-81c63e9d9c01",
  "output_sha256":"服务返回的64位hash",
  "final_text":"只包含这一段口述的最终版本",
  "attribution":"dictation_span"
}
```

调用 `POST /v1/dictations/:id/feedback`。event_id 在重试期间稳定；不能每次重试换一段文本来继续训练同一次口述。hash 必须来自原始服务结果，不能根据最终文本重新算。

如果使用普通 textarea，且无法可靠区分原有文本、另一次口述、粘贴内容或整体重写，可以先仅支持“原本为空、只有一次口述”的强归因场景。其余情况发送 attribution=whole_message，让服务明确跳过学习；不要启发式猜范围然后污染词典。

用户点击“这个词以后写作 E2B”时，才能额外发送 `confirmed_terms:[{"before":"一二逼","after":"E2B"}]`。不要让客户端模型自动填 confirmed_terms 冒充用户确认。

## 失败处理

转录请求超时/失败：保留本地录音用于用户主动重试，不自动高频重发。反馈失败：不阻断 ThreadChat 正常发送，把相同 event_id/hash/body 保存在受限重试队列。409 stale_dictation_output 表示来源错了；409 feedback_already_finalized 表示同一次口述已经定稿，不应盲目重试。

## 调用示例

参见 `examples/threadchat-proxy.ts`。它是可复用的后端 transport，不包含 session 实现、录音按钮或编辑器 range tracking；这些要在 ThreadChat 自己的登录态与输入框中接入。
