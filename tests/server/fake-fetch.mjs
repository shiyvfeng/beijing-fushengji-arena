import { setTimeout } from 'node:timers/promises';
let calls = 0;
globalThis.fetch = async (_url, init = {}) => {
  calls++;
  if (process.env.ARENA_TEST_DELAY) await setTimeout(Number(process.env.ARENA_TEST_DELAY), undefined, { signal: init.signal });
  init.signal?.throwIfAborted();
  if (process.env.ARENA_TEST_FAIL) return new Response('{}', { status: 401 });
  if (process.env.ARENA_TEST_MATCH_TRANSIENT && calls > 55) return new Response('{}', { status: 503 });
  const body = JSON.parse(String(init.body));
  const context = JSON.parse(body.messages.find(message => message.role === 'user').content);
  const location = context.observation?.state?.currentLocation;
  const decision = context.dailyPlanOptions ? { planId: context.dailyPlanOptions.plans[0].id, destinationId: context.dailyPlanOptions.destinationIds[0] }
    : { type: 'move', locationId: location == null ? 0 : (Number(location) + 1) % 20 };
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(decision) } }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
