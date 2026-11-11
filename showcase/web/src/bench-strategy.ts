export type StrategyRunId = "gold-001" | "gold-002";

export interface StrategyEvidence {
  day: string;
  action: string;
}

export interface StrategyReview {
  headline: string;
  evidence: StrategyEvidence[];
  assessment: string;
  tone: "strong" | "mixed" | "weak";
}

export interface CrossRunReview {
  provider: string;
  model: string;
  gold1: string;
  gold2: string;
  conclusion: string;
}

export const STRATEGY_RUN_SUMMARIES: Record<StrategyRunId, string> = {
  "gold-001": "DeepSeek 靠集中重仓拿到最高收益；Qwen 的交易—清债闭环更完整、也更可复现。",
  "gold-002": "Kimi 能把早期套利和资产变现接起来，但冠军收益主要由末日赠品放大；Qwen 则暴露了致命的债务优先级错误。",
};

export const STRATEGY_REVIEWS: Record<StrategyRunId, Record<string, StrategyReview>> = {
  "gold-001": {
    deepseek: {
      headline: "清债后集中重仓",
      evidence: [
        { day: "Day 15", action: "累计还债后债务首次清零。" },
        { day: "Day 30", action: "以 ¥2,295 买入 4 瓶假白酒，共投入 ¥9,180，占当时现金 87%。" },
        { day: "Day 32", action: "以 ¥23,646 卖出 4 瓶，回款 ¥94,584；当日净资产 +¥94,373。" },
      ],
      assessment: "收益最高，但高度集中于一次价格暴击；运行中另有 12 次重试与 Day 29 一次辅助推进。",
      tone: "mixed",
    },
    qwen: {
      headline: "高频套利 + 主动清债",
      evidence: [
        { day: "Day 17–18", action: "100 份香烟 ¥100 → ¥388，单轮盈利 ¥28,800。" },
        { day: "Day 19–21", action: "再做 100 份香烟 ¥175 → ¥373，单轮盈利 ¥19,800。" },
        { day: "Day 23", action: "一次偿还 ¥44,749，债务清零。" },
      ],
      assessment: "29 个非移动动作日；仅 1 次有利个人事件仍取得正收益，是 Gold 1 最完整的交易—清债闭环。",
      tone: "strong",
    },
    openai: {
      headline: "广泛巡游 + 赠品清算",
      evidence: [
        { day: "全场", action: "走过 15 个地点，但主动买入为 0。" },
        { day: "Day 24", action: "卖出 4 瓶赠品假白酒得 ¥13,976，并将所得全部还债。" },
        { day: "Day 34", action: "再卖 4 瓶赠品假白酒得 ¥9,692，并再次全部还债。" },
      ],
      assessment: "能及时处置免费资产，却没有建立主动持仓和盈利循环；最终仍负债 ¥54,260。",
      tone: "weak",
    },
    kimi: {
      headline: "近乎空转",
      evidence: [
        { day: "Day 0", action: "偿还 ¥2,000；此后没有买入、卖出、存款或治疗。" },
        { day: "Day 1–39", action: "39 天中 38 次只在西直门与永安里之间移动。" },
        { day: "Day 37–39", action: "连续触发债务危机，每天健康 -30，Day 39 出局。" },
      ],
      assessment: "没有形成经济策略，债务滚至 ¥123,319；失败来自长期不处理债务，而非单日波动。",
      tone: "weak",
    },
    anthropic: {
      headline: "前期满仓小商品，后程停手",
      evidence: [
        { day: "Day 1–4", action: "玩具、VCD、化妆品连续买入，单次动用现金 77.3%–95.4%。" },
        { day: "Day 7", action: "以 ¥50 买入 21 份 VCD，动用现金 98.9%。" },
        { day: "Day 34–36", action: "债务危机连续令健康 -30，Day 36 出局。" },
      ],
      assessment: "自购交易合计接近盈亏平衡，却只偿还 ¥2,516；问题在于中后程停止交易和还债。",
      tone: "weak",
    },
  },
  "gold-002": {
    kimi: {
      headline: "早期套利 + 赠品变现",
      evidence: [
        { day: "Day 1–2", action: "9 份香烟 ¥106 → ¥208，盈利 ¥918。" },
        { day: "Day 3–4", action: "6 份香烟 ¥156 → ¥469，盈利 ¥1,878。" },
        { day: "Day 39", action: "获赠 2 辆走私汽车后卖得 ¥48,606，偿清余债 ¥4,644。" },
      ],
      assessment: "早期动作有效、末日处置正确；但汽车回款高于最终净资产 ¥43,962，冠军明显受赠品事件驱动。",
      tone: "mixed",
    },
    deepseek: {
      headline: "固定路线 + 被动清算",
      evidence: [
        { day: "全场", action: "西直门与复兴门各到访 20 次，主动买入为 0。" },
        { day: "Day 3 / 14", action: "两次卖出免费香烟，分别回款 ¥936 与 ¥990。" },
        { day: "Day 23", action: "卖出赠品假白酒得 ¥7,480；全场累计还债 ¥11,406。" },
      ],
      assessment: "依赖事件送货、没有主动制造利润，最终净资产 -¥58,286；与 Gold 1 冠军策略差异很大。",
      tone: "weak",
    },
    anthropic: {
      headline: "前期近满仓，后程停手",
      evidence: [
        { day: "Day 1–2", action: "18 份香烟 ¥106 → ¥208，盈利 ¥1,836；买入动用现金 95.4%。" },
        { day: "Day 3–10", action: "12 份香烟 ¥156 → ¥214，盈利 ¥696；买入动用现金 98.2%。" },
        { day: "Day 11–14", action: "16 份化妆品 ¥80 → ¥210，盈利 ¥2,080；之后不再交易。" },
      ],
      assessment: "前三轮套利均为正，但没有把利润转成持续还债能力；最终债务 ¥90,355。",
      tone: "mixed",
    },
    openai: {
      headline: "跨场一致的被动策略",
      evidence: [
        { day: "全场", action: "走过 15 个地点，主动买入仍为 0。" },
        { day: "Day 6", action: "卖出赠品香烟得 ¥2,520，随后还债。" },
        { day: "Day 7", action: "卖出被迫持有的手机得 ¥1,063，随后还债。" },
      ],
      assessment: "高推理档没有改变行动模式；全场累计还债 ¥5,583，最终债务 ¥104,670。",
      tone: "weak",
    },
    qwen: {
      headline: "全图巡游，债务优先级失控",
      evidence: [
        { day: "Day 1–32", action: "到访全部 20 个地点，完成 5 次买入、10 次卖出，但还债为 0。" },
        { day: "Day 29", action: "负债 ¥93,171 时仍花 ¥3,500 治疗 1 点健康，并存入 ¥1,323。" },
        { day: "Day 30–32", action: "债务升至 ¥102,488 → ¥112,736 → ¥124,009，连续每天健康 -30，Day 32 出局。" },
      ],
      assessment: "活跃度最高却没有债务闸门；这是明确的策略优先级错误，不是一次坏运气。",
      tone: "weak",
    },
  },
};

export const CROSS_RUN_REVIEWS: CrossRunReview[] = [
  {
    provider: "openai",
    model: "gpt-5.6-sol",
    gold1: "15 地点、0 主动买入；卖赠品后还债",
    gold2: "15 地点、0 主动买入；卖赠品后还债",
    conclusion: "两场最一致，但一致地缺少主动盈利策略。",
  },
  {
    provider: "anthropic",
    model: "claude-opus-5",
    gold1: "前期 77%–99% 现金重仓小商品",
    gold2: "前三轮套利为正，Day 14 后停手",
    conclusion: "都偏好前置高仓位；中后程债务管理持续偏弱。",
  },
  {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    gold1: "清债后重仓假白酒，终局第 1",
    gold2: "0 主动买入，只清算免费资产",
    conclusion: "收益上限最高，跨场策略差异也最大，复现性较弱。",
  },
  {
    provider: "qwen",
    model: "qwen3.8-max",
    gold1: "高频套利后一次清债 ¥44,749",
    gold2: "活跃交易但 0 还债，Day 32 出局",
    conclusion: "交易意愿稳定，风险控制不稳定；债务闸门决定成败。",
  },
  {
    provider: "kimi",
    model: "kimi-k3",
    gold1: "近乎空转，Day 39 出局",
    gold2: "早期套利，末日赠品变现夺冠",
    conclusion: "行动质量明显改善，但 Gold 2 冠军仍被随机赠品显著放大。",
  },
];
