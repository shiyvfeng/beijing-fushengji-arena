export const defaultModelHosts = ['api.openai.com', 'api.anthropic.com', 'api.deepseek.com', 'dashscope.aliyuncs.com', 'api.moonshot.cn'];
export function validateEndpoint(value, allowedHosts) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('模型地址必须为不含凭据、查询或片段的 HTTP(S) 地址');
  if (!allowedHosts.includes(url.hostname)) throw new Error(`该网关未获允许，请将 ${url.hostname} 加入服务端 ARENA_ALLOWED_MODEL_HOSTS`);
  return url;
}
export function guardedFetch(allowedHosts, signal) {
  return (input, init = {}) => {
    validateEndpoint(String(input), allowedHosts);
    const signals = [signal, init.signal].filter(Boolean);
    return fetch(input, { ...init, redirect: 'error', ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) });
  };
}
