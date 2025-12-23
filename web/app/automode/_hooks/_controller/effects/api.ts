// web/app/automode/_utils/api.ts
import { fetchJsonDebug, type FetchJsonDebugOptions } from "../../../_utils/fetch";

export type ApiCtx = {
  debugOn: boolean;
  pushEntry?: FetchJsonDebugOptions["pushEntry"];
};

export type ApiResult<T> = {
  ok: boolean;
  status: number;
  ms: number;
  // server raw response
  json: T | any;
  text: string;
};

/**
 * A thin API client that standardizes:
 * - URL
 * - JSON headers
 * - debug capture
 * - response shape
 *
 * Actions SHOULD call apiGet/apiPost instead of fetchJsonDebug directly.
 */
export async function apiGet<T>(
  ctx: ApiCtx,
  label: string,
  url: string,
  reqMeta?: any,
  init?: RequestInit
): Promise<ApiResult<T>> {
  const r = await fetchJsonDebug<T>(
    label,
    url,
    {
      ...(init || {}),
      method: "GET",
    },
    reqMeta,
    {
      debugOn: !!ctx?.debugOn,
      pushEntry: ctx?.pushEntry,
    }
  );

  return {
    ok: r.ok,
    status: r.status,
    ms: r.ms,
    json: r.json as any,
    text: r.text,
  };
}

export async function apiPost<T>(
  ctx: ApiCtx,
  label: string,
  url: string,
  body: any,
  reqMeta?: any,
  init?: RequestInit
): Promise<ApiResult<T>> {
  const r = await fetchJsonDebug<T>(
    label,
    url,
    {
      ...(init || {}),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      body: JSON.stringify(body ?? {}),
    },
    // 把 body 也放进 reqMeta 便于 debug panel 追踪（可按需删）
    { ...(reqMeta || {}), body },
    {
      debugOn: !!ctx?.debugOn,
      pushEntry: ctx?.pushEntry,
    }
  );

  return {
    ok: r.ok,
    status: r.status,
    ms: r.ms,
    json: r.json as any,
    text: r.text,
  };
}

/**
 * Convenience helpers:
 * - Ensures API ok
 * - Throws with a consistent error message (so actions can catch & setNotice)
 */
export function assertApiOk<T>(r: ApiResult<T>, label: string): T {
  if (r.ok) return r.json as T;

  // best-effort error extraction
  const msg =
    (r.json && (r.json.error || r.json.message)) ||
    (r.text ? r.text.slice(0, 200) : "") ||
    `Request failed: ${label} (HTTP ${r.status})`;

  throw new Error(msg);
}
