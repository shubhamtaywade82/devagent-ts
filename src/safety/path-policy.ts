import { basename } from "node:path";

const BLOCKED_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "credentials.json",
  "id_rsa",
  "id_ed25519",
]);

const BLOCKED_PATTERNS = [
  /(^|[\\/])\.env(\.|$)/i,
  /(^|[\\/])secrets?[\\/]/i,
  /\.pem$/i,
  /\.key$/i,
];

export function isSensitivePath(path: string): boolean {
  const base = basename(path);
  if (BLOCKED_BASENAMES.has(base)) return true;
  return BLOCKED_PATTERNS.some((re) => re.test(path));
}
