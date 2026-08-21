const SENSITIVE_KEY_PATTERN = /(?:^|[-_])(api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|token|password|secret|prompt|bearer)(?:$|[-_])/i;
const SENSITIVE_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\b(?:sk|rk)-[A-Za-z0-9_-]{10,}\b/i,
] as const;

export interface SecretFinding {
  readonly path: string;
  readonly reason: "sensitive_key" | "credential_pattern";
}

export function findPotentialSecrets(value: unknown): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const visited = new Set<object>();

  function visit(current: unknown, path: string): void {
    if (typeof current === "string") {
      if (SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(current))) {
        findings.push({ path, reason: "credential_pattern" });
      }
      return;
    }
    if (current === null || typeof current !== "object") return;
    if (visited.has(current)) return;
    visited.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        findings.push({ path: childPath, reason: "sensitive_key" });
        continue;
      }
      visit(item, childPath);
    }
  }

  visit(value, "$artifact");
  return findings;
}

export function assertNoPotentialSecrets(value: unknown, artifactName: string): void {
  const findings = findPotentialSecrets(value);
  if (findings.length > 0) {
    const paths = findings.slice(0, 3).map(finding => finding.path).join(", ");
    throw new Error(`${artifactName} 包含疑似敏感凭据字段或内容：${paths}`);
  }
}
