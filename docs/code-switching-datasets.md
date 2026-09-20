# 中英混杂与产品效果评测数据集

SayIt 的评测分成两条线，不能混在一起：

1. **ASR / code-switching**：音频有没有被正确听成中英文混合文本。
2. **speech-to-writing**：在 ASR 文本基础上，是否正确处理口癖、重复、改口、格式、术语和用户偏好，同时不改变意思。

公开数据集主要覆盖第 1 条；Typeless 风格的最终产品效果必须另外用 SayIt 自有数据评测。

## 必测公开集

### 1. CS-Dialogue — 首选主基准

- 104 小时 spontaneous Mandarin-English 对话。
- 200 名说话者。
- 有完整转录，并公开在 Hugging Face：`BAAI/CS-Dialogue`。
- 比朗读数据更接近真实口述与连续对话。
- 用途：主测 Mandarin-English code-switching ASR、长对话及说话人/设备差异。

建议固定官方 test split，不从 test 数据生成词典。

### 2. ASCEND — 小而快的回归集

- 10.62 小时 spontaneous Chinese-English 多轮对话。
- 约 12.3K utterances，23 名双语说话者。
- Hugging Face：`CAiRE/ASCEND`。
- 适合每次模型/provider 变更后快速跑完整回归。

注意：数据来自香港双语说话者，不能单独代表大陆普通话用户。

### 3. ASR-SECoMiCSC — 适合做纯评测集

- Mandarin Chinese mixed with English words/phrases。
- spontaneous conversation。
- 公开部分约 10 小时，带人工转录。
- 许可为 CC BY-NC-ND 4.0；只按许可用于评测，不重新分发或改造发布。
- 用途：额外独立测试集，避免只在一个 corpus 上优化。

## 条件允许再测

### SEAME

- 约 192 小时 spontaneous Mandarin-English conversation/interview。
- 156 名新加坡/马来西亚说话者。
- 是经典 code-switching benchmark，但通过 LDC 分发，通常需要许可/付费。
- 强项：东南亚口音和自然 code-switching；弱项：和大陆普通话技术用户分布不同。

### TALCS

- 论文报告约 587 小时，来自在线一对一英语教学。
- 中英混合规模大，适合压力测试。
- 实际下载与许可可用性需要在使用前再次核实，不把它作为 v0.1 的阻塞依赖。

### ASRU 2019 Mandarin-English challenge

- 历史上有 200+40 小时 code-switching 数据和 500 小时普通话数据。
- 是重要学术基准，但后续文献指出 challenge 数据不再稳定公开获取。
- 只在合法可获取时加入，不围绕它设计主评测。

## SayIt-TechMix：必须自己建

公开 code-switching corpus 无法覆盖 SayIt 真正的核心场景：中文技术口述里夹英文专有名词、缩写、版本号、代码标识符、自然改口和 AI prompt。

v0.1 至少建立 300–500 条私有音频，后续扩到 2,000+。建议分层：

1. **技术实体**：ThreadChat、E2B、Langfuse、Axiom、Supabase、PostgreSQL、Next.js、TypeScript、OpenRouter。
2. **模型/版本**：GLM-5.3-Flash、DeepSeek V4.1 Flash、GPT-5.6、PR #160、Node.js 22、PostgreSQL 16。
3. **字母数字混排**：4C8G、100 万 token、HTTP 429、`SAYIT_MODE`、URL、branch 名。
4. **中文夹英文动作词**：deploy、rebase、merge、fork、benchmark、streaming、fallback。
5. **同音/音译错误**：例如 E2B 被识别成“一二逼”等。
6. **局部改口**：中文改中文、英文改英文、中英交叉改口。
7. **不确定性**：可能、考虑、我猜、应该、暂时、不要、不是；验证 cleanup 不加强语气。
8. **长 AI prompt**：30 秒、60 秒、120 秒连续口述，包含多项要求和中途修正。
9. **噪声与设备**：安静室内、键盘声、咖啡店、Mac 麦克风、手机麦克风。
10. **不同说话者/口音**：不要只录产品作者一人；个人数据另设 personalization longitudinal split。

每条保存两份人工参考：
- `reference_asr`：逐字听写，忠实保留原始口语。
- `reference_text`：用户真正希望发送的最终文字。

这样才能把 ASR 错误和 cleanup 错误分开定位。

## 核心指标

### ASR 层

**MER (Mixture Error Rate)** 作为主指标：中文按字符、英文按词统一做 edit distance。

必须同时拆开报告：

- Chinese CER
- English WER
- English insertion accuracy / recall
- technical term exact accuracy
- alphanumeric / version exact accuracy
- code-switch utterance success rate
- latency p50 / p95

不能只报整体 MER。中文很多时，整体 MER 很容易掩盖英文术语全部识错。

### Speech-to-writing 层

- reference edit cost
- observed post-edit cost
- zero-edit rate
- false-start / self-correction accuracy
- term normalization accuracy
- formatting acceptance
- semantic violation rate
- hallucination rate
- negation / number / modality preservation
- fallback rate
- personalization lift

### 中英混杂专项指标

单独建立 `TERM_SET`，对英文/技术 span 逐项评分：

- exact term accuracy
- casing accuracy
- boundary accuracy（例如 `Next.js` 不能拆成 `Next js`）
- language preservation（不能把英文术语翻译成中文）
- vocabulary lift：不开个人词典 vs 开词典的差值

## 推荐 v0.1 测试矩阵

| 层 | 数据 | 目的 |
| --- | --- | --- |
| ASR 快速回归 | ASCEND test | 每次 provider/config 变更 |
| ASR 主基准 | CS-Dialogue test | spontaneous 中英混杂主成绩 |
| ASR 独立验证 | ASR-SECoMiCSC | 防止过拟合单一 corpus |
| 口音扩展 | SEAME | 新马中英混杂 |
| 产品核心 | SayIt-TechMix | 技术词、版本号、改口、AI prompt |
| 个性化 | SayIt-TechMix longitudinal | 词典/反馈学习是否真的降低编辑成本 |
| 对齐 | 同一批 SayIt-TechMix 音频 → SayIt vs Typeless | blind pairwise parity |

公开 corpus 的 test split 永远冻结。调 prompt、模型、词典策略只能看 dev/calibration；不能根据 test 逐条修 prompt 后继续把它叫 held-out benchmark。
