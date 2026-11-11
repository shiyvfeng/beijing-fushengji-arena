import { createHash } from "node:crypto";

/**
 * Deterministic JSON helpers used by hashes, snapshots and replay artifacts.
 * Arena facts intentionally stay within the JSON data model.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError("canonical Arena JSON rejects NaN and Infinity");
  }
  if (Object.is(value, -0)) return 0;
  return value;
}

function canonicalize(value: unknown): JsonValue {
  if (value === null) return null;

  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return normalizeNumber(value);
    case "undefined":
    case "bigint":
    case "function":
    case "symbol":
      throw new TypeError(`canonical Arena JSON rejects ${typeof value}`);
    case "object": {
      if (Array.isArray(value)) {
        return value.map(item => canonicalize(item));
      }

      const result: Record<string, JsonValue> = {};
      const source = value as Record<string, unknown>;
      for (const key of Object.keys(source).sort()) {
        if (source[key] === undefined) {
          throw new TypeError("canonical Arena JSON rejects undefined object fields");
        }
        result[key] = canonicalize(source[key]);
      }
      return result;
    }
    default:
      throw new TypeError(`canonical Arena JSON rejects ${typeof value}`);
  }
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** FNV-1a 64-bit is small, portable and sufficient for stable artifact IDs. */
export function stableHash(value: unknown): string {
  const input = stableStringify(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < input.length; index++) {
    const codePoint = input.codePointAt(index)!;
    hash ^= BigInt(codePoint);
    hash = (hash * prime) & mask;
    if (codePoint > 0xffff) index++;
  }

  return hash.toString(16).padStart(16, "0");
}

/** Canonical SHA-256 for artifact integrity. */
export function integrityHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

export function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map(item => cloneValue(item)) as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = cloneValue(item);
  }
  return result as T;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
    Object.freeze(value);
  }
  return value;
}

export function immutableClone<T>(value: T): Readonly<T> {
  return deepFreeze(cloneValue(value));
}
