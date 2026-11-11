function responseFor(init) {
  const body = JSON.parse(String(init?.body ?? "{}"));
  const userMessage = body.messages?.find(message => message.role === "user")?.content;
  const context = JSON.parse(String(userMessage ?? "{}"));
  const currentLocation = context.observation?.state?.currentLocation;
  const locationId = currentLocation === null || currentLocation === undefined
    ? 0
    : (Number(currentLocation) + 1) % 20;
  const decision = context.dailyPlanOptions
    ? {
      planId: context.dailyPlanOptions.plans[0].id,
      destinationId: context.dailyPlanOptions.destinationIds[0],
    }
    : { type: "move", locationId };
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: "stop",
      message: { role: "assistant", content: JSON.stringify(decision) },
    }],
    usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

globalThis.fetch = async (_url, init) => responseFor(init);
