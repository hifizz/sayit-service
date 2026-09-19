# 测试与质量评测协议

## 三类验证必须分开

1. 工程回归：scripted LLM、provider HTTP 合约、鉴权、用户隔离、上传限制、幂等、事务回滚、PostgreSQL、构建与启动。只能证明被断言的工程行为。
2. 真实模型评测：合成转录文本和真实音频两种输入。真实音频必须另有原始逐字参考与期望最终文字；先评价 ASR，再评价整理，不混淆 WER/CER 与写作质量。
3. Typeless 对齐：相同原始音频、相同词典/上下文条件，分别获得输出后做盲测。不假设存在可调用的 Typeless 服务端 API，不拿模仿的文本当 Typeless 输出。

## 数据集

仓库 `evaluation/cases.jsonl` 是 32 条人工构造的公开测试文本，覆盖口癖、强调、重复、局部改口、否定、模态、数字/单位/标识符、中英术语、恶意口述指令和 ai_prompt。这不是用户实际录音，也不是宣称有代表性的大规模 benchmark。

真实数据放 `evaluation/private/`（已忽略）。每条包含 id、audio_path、reference_asr、reference_text、标签、必要 context 和允许的词典。音频路径相对 manifest 目录解析。不得把测试音频、参考结果或私人转录发布到公开仓库。

检验个性化收益时，按时间划分 calibration 与 held-out test：只允许 calibration 中已发生的真实用户编辑进入学习，之后冻结该用户画像并测试。不得把测试最终文字先反馈给系统再报告成功率。当前通用 eval runner 对每条 case 使用独立身份，并且不做反馈训练；个性化收益须另做纵向实验，不声称已测。

## 指标定义

- `reference_edit_cost_mean`：模型输出到人工参考文字的 Unicode 字符编辑距离 / max(参考长度,1)。只是参考距离，可以大于 1，不等于真实用户编辑成本。
- `reference_exact_rate`：与固定参考逐字一致率，不等于用户零编辑发送率；多种合理措辞可能得分较低。
- `checked_constraint_pass_rate`：人工指定 must_include/must_not_include 的字面检查，仅覆盖明确列出的约束，不是完整语义准确率。
- `asr_cer`：仅当另有逐字 ASR 人工参考时测量。不能拿润色后的目标文本评价 ASR。
- `fallback_rate`：必须单独披露，不能靠退回原文获得看似安全的总分却隐瞒无润色。
- observed zero-edit / post-edit cost：需要真实用户及可靠口述片段归因；未测为 null。未改动也不自动等于内容正确。
- semantic violation / hallucination：需要人工听原音频判定具体错误，并记录分母。自动 guard 的自评分不能替代这些指标。
- personalisation lift：需要按时间冻结的独立测试或相同样本开关个性化的配对对照。目前不生成虚构结果。
- 延迟：本 runner 记录请求墙钟时间及 p50/p95，记录输入时长。没有真实网络/音频样本的 mock 延迟不代表生产延迟。

每次报告带 mode、commit、dataset SHA256、prompt SHA256、policy version、模型 ID、失败/回退/未评分数量。数字不够的项目用 null；不得把 null 渲染成 0% 错误。

## Typeless 盲测

导出格式：`{"rows":[{"id":"audio_001","input_sha256":"与SayIt同一输入的SHA256","output_text":"Typeless真实输出"}]}`。

`npm run eval:parity -- --left ... --right ...` 验证唯一 ID 和输入 hash 完全匹配，生成 blind.json、单独的 answer-key.private.json 和 ballots 模板。reviewer 应听原始音频，只看 A/B，不看答案键；模板不是实际评分，必须用真实判断替换。

重点问“哪个更接近本来想发的意思、修改更少”，而不是“哪个文笔华丽”。每条可记 A/B/tie、两边是否存在语义错误，以及原因。用 `--votes` 输入人工 ballots 后才生成胜/负/平、非平局胜率和 Wilson 95% 区间；未评分数量必须披露。区间仅对应当前样本、单次判断的二项近似，不可当作产品总体保证。

不要自动上传私人报告。公开 CI 只跑公开合成文本/无 Key mock，live workflow 仅显式触发并使用仓库 secrets。真实音频优先在受控本地/服务器运行。
