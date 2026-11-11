import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stableHash } from "../core/stable-value.js";

const REDACTED = "[REDACTED]";
const CREDENTIAL_FIELD = /^(?:authorization|proxy[-_]?authorization|api[-_]?key|x[-_]?api[-_]?key|cookie|set[-_]?cookie|password|passwd|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|id[-_]?token|auth[-_]?token|session[-_]?token|private[-_]?key|credential|credentials)$/iu;

export interface RawExchangeCapture {
  readonly modelCallId: string;
  readonly provider: string;
  readonly endpoint: string;
  readonly request: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  };
  readonly response?: Response;
  readonly transportError?: boolean;
}

export interface RawExchangeRecorder {
  capture(exchange: RawExchangeCapture): void;
  flush(): Promise<void>;
}

export interface RawExchangeRecorderOptions {
  readonly enabled: boolean;
  readonly diagnosticsRoot: string;
  readonly matchId: string;
  readonly phase: "probe" | "stability" | "match";
  readonly secrets: readonly string[];
}

function redactString(value: string, secrets: readonly string[]): string {
  let result = value
    .replace(/\bBearer\s+[^\s"',}]+/giu, "Bearer [REDACTED]")
    .replace(
      /\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]+/giu,
      "$1: [REDACTED]",
    );
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join(REDACTED);
  }
  return result;
}

function sanitize(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map(item => sanitize(item, secrets));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = CREDENTIAL_FIELD.test(key) ? REDACTED : sanitize(item, secrets);
  }
  return result;
}

function sanitizeBody(body: string, secrets: readonly string[]): unknown {
  try {
    return sanitize(JSON.parse(body) as unknown, secrets);
  } catch {
    return redactString(body, secrets);
  }
}

function headersToRecord(headers: Headers, secrets: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  headers.forEach((value, key) => {
    result[key] = CREDENTIAL_FIELD.test(key) ? REDACTED : redactString(value, secrets);
  });
  return result;
}

export function createRawExchangeRecorder(
  options: RawExchangeRecorderOptions,
): RawExchangeRecorder | undefined {
  if (!options.enabled) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(options.matchId)) {
    throw new Error("原始交换诊断 matchId 格式无效");
  }
  const outputDir = join(
    options.diagnosticsRoot,
    options.matchId,
    options.phase,
  );
  const pending = new Set<Promise<void>>();
  let sequence = 0;
  let writeFailed = false;

  return Object.freeze({
    capture(exchange: RawExchangeCapture): void {
      const index = sequence++;
      const operation = (async () => {
        let responseBody: string | null = null;
        let responseHeaders: Record<string, unknown> | null = null;
        let responseStatus: number | null = null;
        if (exchange.response) {
          responseStatus = exchange.response.status;
          responseHeaders = headersToRecord(exchange.response.headers, options.secrets);
          try {
            responseBody = await exchange.response.text();
          } catch {
            responseBody = "[UNAVAILABLE]";
          }
        }
        const artifact = {
          artifactType: "arena-raw-exchange-v1",
          phase: options.phase,
          modelCallId: exchange.modelCallId,
          provider: exchange.provider,
          endpoint: redactString(exchange.endpoint, options.secrets),
          request: {
            method: exchange.request.method,
            headers: sanitize(exchange.request.headers, options.secrets),
            body: sanitizeBody(exchange.request.body, options.secrets),
          },
          response: exchange.response ? {
            status: responseStatus,
            headers: responseHeaders,
            body: sanitizeBody(responseBody ?? "", options.secrets),
          } : null,
          transportError: exchange.transportError === true,
        };
        mkdirSync(outputDir, { recursive: true });
        const suffix = stableHash({ modelCallId: exchange.modelCallId, index }).replace(/^sha256:/u, "");
        const target = join(outputDir, `${String(index).padStart(4, "0")}-${suffix}.json`);
        const temporary = `${target}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
        renameSync(temporary, target);
      })();
      pending.add(operation);
      void operation.then(
        () => pending.delete(operation),
        () => {
          writeFailed = true;
          pending.delete(operation);
        },
      );
    },
    async flush(): Promise<void> {
      await Promise.all([...pending].map(operation => operation.catch(() => undefined)));
      if (writeFailed) throw new Error("原始交换诊断写入失败");
    },
  });
}
