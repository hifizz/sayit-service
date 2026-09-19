# 反馈、词典与个性化学习规范

## Requirement: 精确归因与幂等

反馈必须包含 event_id、output_sha256、final_text、attribution。输出 hash 不匹配返回 409。访问另一用户的记录返回 404。

attribution=dictation_span 表示 final_text 仅为该次口述插入片段的最终版本。whole_message 表示无法分离原有文字、其他口述或新增内容：保存跳过结果，不训练，也不把整条消息编辑距离算作口述编辑成本。

每次口述只有一个最终反馈。相同指纹重放返回同一回执，不重复调用模型或增加频次；不同最终反馈返回 409。反馈、纠正记录、词典和风格更新在同一事务提交。失败不能留下半条学习结果。

## Requirement: 服务端 diff 对齐

服务端计算 UTF-16 范围的 token diff（与浏览器字符串范围一致）。模型只分类这些 span，不得编造 before/after。返回的 span_index 必须无重复、无遗漏、在范围内。超过安全复杂度预算的文本放弃自动学习，不进行无限制二次方比较。

## Requirement: 分类与学习许可

TERM_CORRECTION/ASR_CORRECTION/SPELLING：短语级、高置信度、非风险替换可成为词典候选。模型的置信度只是启发式分数，不是统计校准概率；没有听音频不能证明是 ASR 错误。

CONTENT_ADDITION/CONTENT_REMOVAL/MEANING_CHANGE/UNKNOWN：不得成为持久词典和 few-shot 规则。纯数字、日期/账号等长数字、URL/邮箱、明显密钥、否定和确定程度变化都阻止自动词典学习。纯插入或纯删除不得变成别名映射。

GRAMMAR/PUNCTUATION/FORMAT/STYLE：仅可能贡献抽象展示偏好，不做逐字全局替换。包含内容变化的反馈不得更新风格。风格更新须额外通过语义等价检查。

## Requirement: 候选到生效

明确大小写/空格规范（如 thread chat → ThreadChat）及用户显式确认的窄词条可立即 active。不确定同音替换（如一二逼 → E2B）先 candidate；至少两次独立 dictation 的同一 before→after 才可激活。重放反馈不构成第二次证据。

候选不带可执行 aliases；确认某一 alias 只能激活该 alias，不得连带激活之前其他猜测。active 才进入 ASR bias 或可复用的纠正提示。删除词条产生 blocked 状态，同时清掉可重新触发该词的纠正样本；自动反馈不能取消 blocked，手工恢复才可。

## Requirement: 抽象风格

只保存 verbosity、formality、bulletPreference 等数值与观察次数。至少 5 次符合条件的独立观察后才应用。不同 context type/project 单独聚合。不得保存“我觉得可以考虑→直接做”这类危险替换；不得学习降低不确定性的偏好。

“直接发送没修改”不是可自动验证的正确标注，不增加风格或词典证据。可测量该用户的零编辑行为，但不能将其直接等同于语义准确率。

## Requirement: 用户控制与保留

提供个性化开关、重置、词条屏蔽、记录删除和全部数据删除。关闭自动个性化后不读取纠正 few-shot 或风格，不从反馈继续学习；手工词典仍可使用。默认暂存文本/上下文 168 小时用于归因，音频不落库。词典/抽象风格另行保留到删除，不能宣称系统是云端零内容留存。
