import { getCrawlPolicy, getSettings, userAgent } from "../config";
import { sha256, sleep } from "../util";
import { serveFixture } from "./fixtures";
import { assertPublicUrl } from "./ssrf";
import { normalizeHtml, normalizePdf, type NormalizedDocument } from "./normalize";

export type ErrorCode =
  | "DNS_FAILURE"
  | "CONNECTION_TIMEOUT"
  | "HTTP_403"
  | "HTTP_404"
  | "HTTP_429"
  | "HTTP_5XX"
  | "HTTP_4XX"
  | "ROBOTS_DISALLOWED"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "FILE_TOO_LARGE"
  | "PDF_PARSE_FAILED"
  | "EMPTY_CONTENT"
  | "NETWORK_ERROR";

export interface FetchOutcome {
  ok: boolean;
  requestedUrl: string;
  finalUrl: string | null;
  status: number | null;
  contentType: string | null;
  contentHash: string | null;
  textHash: string | null;
  doc: NormalizedDocument | null;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  fetcherVersion: string;
  parserVersion: string;
}

const lastRequestAt = new Map<string, number>();

async function politeDelay(host: string, delaySeconds: number) {
  if (delaySeconds <= 0) return;
  const wait = (lastRequestAt.get(host) ?? 0) + delaySeconds * 1000 - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}

function codeForStatus(status: number): ErrorCode {
  if (status === 403) return "HTTP_403";
  if (status === 404 || status === 410) return "HTTP_404";
  if (status === 429) return "HTTP_429";
  if (status >= 500) return "HTTP_5XX";
  return "HTTP_4XX";
}

const TRANSIENT: ErrorCode[] = ["CONNECTION_TIMEOUT", "HTTP_429", "HTTP_5XX", "NETWORK_ERROR"];

async function readLimited(res: Response, max: number): Promise<Buffer | null> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.from(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

interface RawResult {
  status: number;
  finalUrl: string;
  contentType: string;
  body: Buffer | null;
  errorCode?: ErrorCode;
  errorMessage?: string;
  retryAfterMs?: number;
}

async function rawFetch(url: string): Promise<RawResult> {
  const policy = getCrawlPolicy().http;
  if (url.startsWith("fixture://")) {
    const page = await serveFixture(url);
    return { status: page.status, finalUrl: url, contentType: page.contentType, body: Buffer.from(page.body) };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), policy.connect_timeout_ms + policy.read_timeout_ms);
  try {
    // Follow redirects manually so every hop is re-validated against private/loopback targets (SSRF guard).
    let current = url;
    let res!: Response;
    for (let hop = 0; hop <= 5; hop++) {
      await assertPublicUrl(current);
      res = await fetch(current, {
        signal: ctl.signal,
        redirect: "manual",
        headers: { "user-agent": userAgent(), accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5", "accept-language": "en-IN,en;q=0.9" },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel();
        current = new URL(loc, current).toString();
        if (hop === 5) throw Object.assign(new Error("too many redirects"), { cause: { code: "REDIRECT_LIMIT" } });
        continue;
      }
      break;
    }
    const finalUrl = current;
    const ra = res.headers.get("retry-after");
    const retryAfterMs = ra && /^\d+$/.test(ra) ? Math.min(+ra * 1000, policy.max_retry_after_ms) : undefined;
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > policy.max_response_bytes) {
      await res.body?.cancel();
      return { status: res.status, finalUrl: finalUrl, contentType, body: null, errorCode: "FILE_TOO_LARGE", errorMessage: `content-length ${declared} exceeds limit` };
    }
    if (res.status >= 400) {
      await res.body?.cancel();
      return { status: res.status, finalUrl: finalUrl, contentType, body: null, retryAfterMs };
    }
    const body = await readLimited(res, policy.max_response_bytes);
    if (!body) return { status: res.status, finalUrl: finalUrl, contentType, body: null, errorCode: "FILE_TOO_LARGE", errorMessage: "response exceeded size limit" };
    return { status: res.status, finalUrl: finalUrl, contentType, body };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const code = err.cause?.code ?? "";
    if (err.message.startsWith("blocked ")) return { status: 0, finalUrl: url, contentType: "", body: null, errorCode: "NETWORK_ERROR", errorMessage: err.message };
    if (err.name === "AbortError") return { status: 0, finalUrl: url, contentType: "", body: null, errorCode: "CONNECTION_TIMEOUT", errorMessage: "request timed out" };
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { status: 0, finalUrl: url, contentType: "", body: null, errorCode: "DNS_FAILURE", errorMessage: err.message };
    if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") return { status: 0, finalUrl: url, contentType: "", body: null, errorCode: "CONNECTION_TIMEOUT", errorMessage: err.message };
    return { status: 0, finalUrl: url, contentType: "", body: null, errorCode: "NETWORK_ERROR", errorMessage: `${err.message}${code ? " (" + code + ")" : ""}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a small text resource (robots/sitemap) without HTML normalisation. */
export async function fetchText(url: string, delaySeconds = 1): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    await politeDelay(new URL(url).hostname, delaySeconds);
    const r = await rawFetch(url);
    if (!r.body || r.status >= 400 || r.errorCode) return { ok: false, status: r.status, text: "" };
    return { ok: true, status: r.status, text: r.body.toString("utf8").slice(0, 3_000_000) };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

/** Fetch with polite per-domain delay, bounded retries + backoff, then parse into normalised text. */
export async function fetchAndNormalize(url: string, delaySeconds = 2): Promise<FetchOutcome> {
  const policy = getCrawlPolicy().http;
  const settings = getSettings();
  const base: FetchOutcome = {
    ok: false, requestedUrl: url, finalUrl: null, status: null, contentType: null, contentHash: null, textHash: null,
    doc: null, errorCode: null, errorMessage: null, fetcherVersion: settings.fetcher_version, parserVersion: settings.parser_version,
  };
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return { ...base, errorCode: "NETWORK_ERROR", errorMessage: "invalid URL" };
  }

  let raw: RawResult | null = null;
  for (let attempt = 0; attempt <= policy.retries; attempt++) {
    await politeDelay(host, delaySeconds);
    raw = await rawFetch(url);
    const code: ErrorCode | null = raw.errorCode ?? (raw.status >= 400 ? codeForStatus(raw.status) : null);
    if (!code || !TRANSIENT.includes(code) || attempt === policy.retries || url.startsWith("fixture://")) break;
    const backoff = raw.retryAfterMs ?? policy.backoff_base_ms * 2 ** attempt + Math.floor(Math.random() * 400);
    await sleep(backoff);
  }
  if (!raw) return { ...base, errorCode: "NETWORK_ERROR", errorMessage: "no response" };

  const out: FetchOutcome = { ...base, finalUrl: raw.finalUrl, status: raw.status || null, contentType: raw.contentType || null };
  const code: ErrorCode | null = raw.errorCode ?? (raw.status >= 400 ? codeForStatus(raw.status) : null);
  if (code) return { ...out, errorCode: code, errorMessage: raw.errorMessage ?? `HTTP ${raw.status}` };
  if (!raw.body || raw.body.length === 0) return { ...out, errorCode: "EMPTY_CONTENT", errorMessage: "empty response body" };

  out.contentHash = sha256(raw.body);
  const ct = raw.contentType;
  const isPdf = ct.includes("pdf") || raw.body.subarray(0, 5).toString() === "%PDF-";
  const isHtml = ct.includes("html") || ct.includes("xml") || /^\s*<(!doctype|html)/i.test(raw.body.subarray(0, 200).toString());
  if (!isPdf && !isHtml) return { ...out, errorCode: "UNSUPPORTED_CONTENT_TYPE", errorMessage: `unsupported content-type ${ct || "unknown"}` };

  try {
    out.doc = isPdf ? await normalizePdf(raw.body) : normalizeHtml(raw.body.toString("utf8"), raw.finalUrl);
  } catch (e) {
    return { ...out, errorCode: "PDF_PARSE_FAILED", errorMessage: (e as Error).message };
  }
  if (out.doc.text.replace(/\s+/g, "").length < 40) {
    return { ...out, doc: out.doc, errorCode: "EMPTY_CONTENT", errorMessage: "page has almost no visible text (may need JS rendering or OCR)" };
  }
  out.textHash = sha256(out.doc.text);
  out.ok = true;
  return out;
}
