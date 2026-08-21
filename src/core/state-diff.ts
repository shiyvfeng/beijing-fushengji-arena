import { stableStringify } from "./stable-value.js";

export interface StateDiffEntry {
  readonly before?: unknown;
  readonly after?: unknown;
}

export type StateDiff = Readonly<Record<string, Readonly<StateDiffEntry>>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function visit(
  before: unknown,
  after: unknown,
  path: string,
  result: Record<string, StateDiffEntry>,
): void {
  if (before === undefined || after === undefined) {
    if (before !== after) {
      result[path || "$state"] = {
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
      };
    }
    return;
  }
  if (stableStringify(before) === stableStringify(after)) return;

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index++) {
      visit(before[index], after[index], `${path}[${index}]`, result);
    }
    return;
  }

  if (isRecord(before) && isRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      visit(before[key], after[key], path ? `${path}.${key}` : key, result);
    }
    return;
  }

  result[path || "$state"] = { before, after };
}

export function diffState(before: unknown, after: unknown): StateDiff {
  const result: Record<string, StateDiffEntry> = {};
  visit(before, after, "", result);
  return result;
}
