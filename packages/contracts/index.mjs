export const providers = ['openai', 'anthropic', 'deepseek', 'qwen', 'kimi', 'openai-compatible'];
export const providerUrls = {
  openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1',
  deepseek: 'https://api.deepseek.com', qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  kimi: 'https://api.moonshot.cn/v1', 'openai-compatible': '',
};
export const defaultLimits = {
  seed: 20260820, slotRotationIndex: 0, maxActionsPerAgent: 160,
  decisionTimeoutMs: 120000, totalWallClockMs: 19200000,
  providerTimeBudgetMs: 2700000, maxOutputTokens: 512,
};
export const terminalStates = ['succeeded', 'failed', 'cancelled', 'interrupted'];
export const statusLabels = { draft: '草稿', queued: '排队中', running: '运行中', cancelling: '正在取消', cancelled: '已取消', succeeded: '已完成', failed: '失败', interrupted: '执行中断' };
export const stageLabels = { validate: '校验配置', probe: '模型探测', stability: '稳定性测试', match: '正式比赛', finalize: '整理结果', ready: '结果就绪' };
export function validateTaskInput(input) {
  if (!input || typeof input !== 'object') throw new Error('任务配置无效');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('任务名称需要 1–100 个字符');
  if (!Array.isArray(input.profileIds) || input.profileIds.length !== 5 || input.profileIds.some(id => typeof id !== 'string')) throw new Error('请选择五个模型配置');
  if (typeof input.completionAssisted !== 'boolean') throw new Error('请选择比赛轨道');
  const limits = { ...defaultLimits, ...input.limits };
  const bounds = { seed: [0, 2147483647], slotRotationIndex: [0, 4], maxActionsPerAgent: [40, 320], decisionTimeoutMs: [1, 600000], totalWallClockMs: [1, 2147483647], providerTimeBudgetMs: [1, 2147483647], maxOutputTokens: [16, 4096] };
  for (const [key, [min, max]] of Object.entries(bounds)) if (!Number.isSafeInteger(limits[key]) || limits[key] < min || limits[key] > max) throw new Error(`${key} 必须是 ${min}–${max} 的整数`);
  return { name: input.name.trim(), profileIds: [...input.profileIds], completionAssisted: input.completionAssisted,
    limits: Object.fromEntries(Object.keys(bounds).map(key => [key, limits[key]])) };
}
