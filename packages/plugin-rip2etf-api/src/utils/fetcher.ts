import { debugHttp, debugLog } from "./logger";

const DEFAULT_HEADERS = {
  "User-Agent": "rip2etf-plugin/0.1",
  Accept: "application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5"
} as const;

async function request(url: string, opts?: RequestInit) {
  const method = opts?.method ?? "GET";
  const start = Date.now();

  const res = await fetch(url, {
    ...opts,
    headers: {
      ...DEFAULT_HEADERS,
      ...(opts?.headers ?? {})
    }
  });

  debugHttp(method, url, {
    status: res.status,
    durationMs: Date.now() - start
  });

  if (!res.ok) {
    const body = await res.text();
    debugLog("http_error", { method, url, status: res.status, body: body.slice(0, 500) });
    throw new Error(`Request failed ${res.status} ${res.statusText} for ${url}: ${body}`);
  }

  return res;
}

export async function getJSON<T = any>(url: string, opts?: RequestInit): Promise<T> {
  const res = await request(url, opts);
  try {
    const json = (await res.json()) as T;
    debugLog("json_response", { url, preview: JSON.stringify(json).slice(0, 500) });
    return json;
  } catch (error) {
    debugLog("json_parse_error", { url, error: (error as Error).message });
    throw error;
  }
}

export async function getText(url: string, opts?: RequestInit): Promise<string> {
  const res = await request(url, opts);
  const text = await res.text();
  debugLog("text_response", { url, preview: text.slice(0, 500) });
  return text;
}
