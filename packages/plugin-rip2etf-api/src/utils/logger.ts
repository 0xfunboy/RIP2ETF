import { rip2etfSettings } from "../settings";

const SECRET_PARAMS = new Set(["apikey", "token", "key", "api_key"]);

function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const [key] of url.searchParams) {
      if (SECRET_PARAMS.has(key.toLowerCase())) {
        url.searchParams.set(key, "***");
      }
    }
    return url.toString();
  } catch {
    return raw.replace(/(api[_-]?key|token|secret)=([^&]+)/gi, "$1=***");
  }
}

export function debugLog(message: string, ...details: unknown[]) {
  if (!rip2etfSettings.DEBUG) return;
  // eslint-disable-next-line no-console
  console.debug("[rip2etf]", message, ...details);
}

export function debugHttp(
  method: string,
  url: string,
  options: { status?: number; durationMs?: number; extra?: Record<string, unknown> } = {}
) {
  if (!rip2etfSettings.DEBUG) return;
  const payload = {
    method,
    url: sanitizeUrl(url),
    ...("status" in options ? { status: options.status } : {}),
    ...("durationMs" in options ? { durationMs: options.durationMs } : {}),
    ...("extra" in options ? options.extra : {})
  };
  debugLog("http", payload);
}
