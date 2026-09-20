# 两阶段评测：ASR 与 Rewrite 完全解耦

SayIt 不再用一个端到端分数同时评价“听错了”和“改错了”。正式 benchmark 固定拆成两个独立 leaderboard。

## Stage A — ASR / 转文字

**输入**：真实音频 + 可选 key terms。

**输出**：provider 的原始 transcript。此阶段禁止调用 cleanup LLM，也禁止拿最终润色文本当 ASR reference。

数据格式见 `evaluation/asr-manifest.example.jsonl`：

- `reference_asr`：人工逐字转录。
- `key_terms`：允许给 provider 的词典提示。
- `term_set`：必须独立统计 exact accuracy 的英文/技术实体。
- `tags`：zh_en、technical_terms、numbers、self_correction 等。

主指标：MER（后续 TechMix scorer 增加中文字符+英文词混合 tokenization）、Chinese CER、English WER、technical-term exact accuracy、alphanumeric accuracy、p50/p95 latency、provider cost/hour。当前通用 runner 已输出 Unicode CER、term exact 与 latency；MER/WER 需要带语言 span 标注的数据后再计算，不能伪造。

运行：

```bash
XAI_API_KEY=... npm run eval:asr -- \
  --provider xai \
  --model grok-voice-transcribe-2.0 \
  --dataset evaluation/private/asr.jsonl \
  --out reports/asr/xai-grok-voice-2
```

每个 provider/model 生成独立 report。之后接 Groq、ElevenLabs、AssemblyAI、OpenAI 等 adapter 时保持同一 manifest 与 scorer。

### 词典 A/B

每个模型至少跑两遍：

1. `key_terms=[]`
2. 同一条音频使用允许的 personal/domain key terms

报告 Vocabulary Lift = with-keyterms - without-keyterms。禁止从 test reference 自动抽词再作为 key terms；词典只能来自预先冻结的 domain dictionary 或 calibration 历史。

## Stage B — Rewrite / 改写修饰

**输入**：固定的 `raw_transcript` 文本，不调用任何 ASR。

这保证 GLM-5.3-Flash、DeepSeek V4.1 Flash、Grok 等 cleanup 模型看到完全相同输入，ASR 波动不会污染 rewrite 排名。

数据格式见 `evaluation/rewrite-manifest.example.jsonl`。现有 `evaluation/cases.jsonl` 也可直接使用。

主指标：

- reference edit cost
- constraint pass rate
- false-start/self-correction accuracy
- technical-term normalization
- negation / number / modality preservation
- not-answering rate
- hallucination / semantic violation（人工审阅）
- fallback rate
- p50/p95 latency
- LLM input/output token 与美元成本（provider 返回 usage 后记录）

运行：

```bash
LLM_API_KEY=... npm run eval:rewrite -- \
  --base-url https://你的中转/v1 \
  --model glm-5.3-flash \
  --dataset evaluation/cases.jsonl \
  --out reports/rewrite/glm-5.3-flash
```

换模型只改 `--model` / `--base-url` / `--api-key-env`。不要把 ASR 输出动态接入这个 leaderboard。

## Stage C — End-to-end（最后才做）

A、B 各自选出候选后，再组合：

```text
Audio → ASR candidate → Rewrite candidate → final text
```

Stage C 用真实用户的 zero-edit rate / post-edit cost 和 Typeless blind pairwise 决定生产方案。它用于产品决策，不用于定位 ASR 或 rewrite 的单项能力。

## 成本核算

### ASR

```text
asr_cost = audio_hours × provider_price_per_hour
```

同一数据集记录实际总音频时长后，按当次官方单价计算。价格必须作为 run metadata/versioned pricing snapshot 记录，不能把今天价格硬编码成永久事实。

### Rewrite

```text
rewrite_cost =
  input_tokens × input_price
+ output_tokens × output_price
+ guard_input/output
+ repair calls（若发生）
```

必须区分正常一次 rewrite + guard 与发生 repair 的请求。若中转不返回 usage，则成本标为 null，不根据字符数冒充真实 token usage。

### 最终产品成本

```text
cost_per_accepted_dictation =
(total ASR + rewrite + guard + repair cost) / zero_edit_accepted_count
```

这比单纯 $/audio-hour 更适合 SayIt。

## 数据隔离

公开 corpus 的 test split 永远冻结。SayIt-TechMix 至少拆 calibration/dev/test。词典学习、prompt 调整只能使用 calibration/dev；test 的 reference_asr/reference_text 不允许进入 prompt、词典或 feedback memory。

真实 API Key 只通过环境变量提供，报告只保存 provider/model/base URL origin，不保存 Key。
