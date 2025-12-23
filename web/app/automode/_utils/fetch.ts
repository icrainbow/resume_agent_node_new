// web/app/automode/_utils/fetch.ts
import type { DebugEntry } from "../_types/types";
import { nowIso, previewText } from "./utils";

export type FetchJsonDebugResult<T = any> = {
  status: number;
  ms: number;
  text: string;
  json: T | any;
  ok: boolean;
};

export type FetchJsonDebugOptions = {
  debugOn: boolean;
  pushEntry?: (entry: DebugEntry) => void;
  maxEntries?: number; // 预留；如需截断请在 pushEntry 内处理
};

// performance.now fallback (defensive; usually present in browsers)
function nowMs(): number {
  try {
    return typeof performance !== "undefined" && performance?.now
      ? performance.now()
      : Date.now();
  } catch {
    return Date.now();
  }
}

/**
 * Generic fetch wrapper:
 * - Measures ms
 * - Parses JSON best-effort
 * - Emits DebugEntry via pushEntry if debugOn
 */
export async function fetchJsonDebug<T = any>(
  label: string,
  url: string,
  init: RequestInit,
  reqMeta?: any,
  opts?: FetchJsonDebugOptions
): Promise<FetchJsonDebugResult<T>> {
  const t0 = nowMs();
  const method = (init?.method || "GET").toUpperCase();

  let status = 0;
  let text = "";
  let json: any = null;
  let ok = false;

  const debugOn = !!opts?.debugOn;
  const pushEntry = opts?.pushEntry;

  try {
    console.info(`[dbg][${label}] -> ${method} ${url}`, reqMeta || "");
    const r = await fetch(url, init);
    status = r.status;

    // Read response text once
    text = await r.text();

    // Best-effort JSON parse:
    // - try if content-type indicates json OR text looks like json
    const ct = r.headers.get("content-type") || "";
    const looksJson = (() => {
      const s = (text || "").trim();
      return s.startsWith("{") || s.startsWith("[");
    })();

    if (text && (ct.includes("application/json") || looksJson)) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    } else {
      json = null;
    }

    ok = r.ok;
    const ms = Math.round(nowMs() - t0);

    if (debugOn && pushEntry) {
      pushEntry({
        ts: nowIso(),
        label,
        url,
        method,
        ms,
        status,
        ok,
        reqMeta,
        resTextPreview: previewText(text),
        resJson: json,
      });
    }

    console.info(
      `[dbg][${label}] <- ${status} (${ms}ms)`,
      json ?? previewText(text)
    );
    return { status, ms, text, json, ok };
  } catch (e: any) {
    const ms = Math.round(nowMs() - t0);
    const errMsg = e?.message || String(e);

    if (debugOn && pushEntry) {
      pushEntry({
        ts: nowIso(),
        label,
        url,
        method,
        ms,
        status,
        ok: false,
        reqMeta,
        resTextPreview: previewText(text),
        resJson: json,
        error: errMsg,
      });
    }

    console.error(`[dbg][${label}] !! error`, errMsg);
    return { status, ms, text, json, ok: false };
  }
}
