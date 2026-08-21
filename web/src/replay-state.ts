import type { FinalResult, LuckAudit, ReplayArtifact, ReplayDay } from "./replay-types.ts";

export interface VisibleReplaySlice {
  visibleThroughDay: number;
  days: ReplayDay[];
  latestDay: ReplayDay;
  finalResults?: FinalResult[];
  luckAudit?: LuckAudit;
}

export function createVisibleReplaySlice(
  replay: ReplayArtifact,
  requestedDay: number,
): VisibleReplaySlice {
  const visibleThroughDay = Math.max(1, Math.min(
    replay.totalDays,
    Number.isFinite(requestedDay) ? Math.floor(requestedDay) : 1,
  ));
  const days = replay.days.filter(day => day.day <= visibleThroughDay);
  const latestDay = days.at(-1);
  if (!latestDay) throw new Error("Replay 缺少第 1 天数据");
  return {
    visibleThroughDay,
    days,
    latestDay,
    ...(visibleThroughDay === replay.totalDays
      ? { finalResults: replay.finalResults, luckAudit: replay.luckAudit }
      : {}),
  };
}
