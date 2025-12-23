// web/app/api/parse/resume/route.ts
import { NextResponse } from "next/server";
import path from "path";
import os from "os";
import { promises as fs } from "fs";
import crypto from "crypto";

export const runtime = "nodejs";

const WORKER_BASE = process.env.WORKER_BASE_URL || "http://127.0.0.1:8000";
const WORKER_TIMEOUT_MS = Number(process.env.WORKER_TIMEOUT_MS || "15000"); // 15s default

const DEV = process.env.NODE_ENV !== "production";

// ---------- helpers ----------
function nowMs() {
  return Date.now();
}

function safeBaseName(name: string) {
  const base = path.basename(name || "file");
  // keep letters/numbers/._- only
  return base.replace(/[^\w.\-]+/g, "_");
}

function rid() {
  return crypto.randomBytes(6).toString("hex"); // short request id
}

function log(id: string, ...args: any[]) {
  if (!DEV) return;
  // eslint-disable-next-line no-console
  console.log(`[api/parse/resume][${id}]`, ...args);
}

function warn(id: string, ...args: any[]) {
  if (!DEV) return;
  // eslint-disable-next-line no-console
  console.warn(`[api/parse/resume][${id}]`, ...args);
}

function err(id: string, ...args: any[]) {
  if (!DEV) return;
  // eslint-disable-next-line no-console
  console.error(`[api/parse/resume][${id}]`, ...args);
}

async function writeTempFile(file: File, prefix: string, id: string) {
  // === BREAKPOINT === inspect file metadata here
  const t0 = nowMs();

  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);

  const fname = `${prefix}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}-${safeBaseName(file.name || "upload")}`;
  const abs = path.join(os.tmpdir(), fname);

  await fs.writeFile(abs, buf);

  const dt = nowMs() - t0;
  log(id, `[tmp] wrote ${prefix}`, {
    abs,
    bytes: buf.length,
    ms: dt,
    name: file.name,
    type: (file as any).type,
  });

  return abs;
}

async function tryReadJson(res: Response, id: string) {
  const t0 = nowMs();
  const text = await res.text();
  const dt = nowMs() - t0;

  try {
    const json = text ? JSON.parse(text) : null;
    log(id, `[worker] body parsed as JSON`, { ms: dt, textLen: text?.length || 0 });
    return { text, json };
  } catch {
    warn(id, `[worker] body NOT JSON`, {
      ms: dt,
      textHead: (text || "").slice(0, 500),
    });
    return { text, json: null };
  }
}

function summarizeSections(sections: any[]) {
  const out = {
    total: Array.isArray(sections) ? sections.length : 0,
    groups: 0,
    leaves: 0,
    missingParentIdOnLeaf: 0,
    sample: [] as Array<{
      id?: any;
      title?: any;
      isGroup?: any;
      parentId?: any;
      textLen?: number;
    }>,
  };

  if (!Array.isArray(sections)) return out;

  for (const s of sections) {
    const isGroup = !!s?.isGroup;
    if (isGroup) out.groups += 1;
    else {
      out.leaves += 1;
      if (!s?.parentId) out.missingParentIdOnLeaf += 1;
    }
  }

  out.sample = sections.slice(0, 8).map((s) => ({
    id: s?.id,
    title: s?.title,
    isGroup: s?.isGroup,
    parentId: s?.parentId,
    textLen: (s?.text || "").length,
  }));

  return out;
}

// ---------- main ----------
export async function POST(req: Request) {
  const id = rid();
  const tAll = nowMs();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);

  // Helpful: see request headers quickly (do NOT print cookies/authorization)
  if (DEV) {
    const h: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (lk.includes("cookie") || lk.includes("authorization")) return;
      h[k] = v;
    });
    log(id, `start`, {
      method: req.method,
      url: (req as any).url || "(no url)",
      worker: WORKER_BASE,
      timeoutMs: WORKER_TIMEOUT_MS,
      headers: h,
    });
  }

  // ===== DEV helpers: summarize schema json (do not dump whole content) =====
  const summarizeSchemaJson = (schemaObj: any) => {
    const groups = Array.isArray(schemaObj?.groups) ? schemaObj.groups : [];
    const sections = Array.isArray(schemaObj?.sections) ? schemaObj.sections : [];

    const pickSec = (s: any) => ({
      id: s?.id,
      idType: typeof s?.id,
      title: s?.title,
      parentId: s?.parentId ?? null,
      parent_id: s?.parent_id ?? null,
      isGroup: s?.isGroup,
      anchor: s?.anchor,
      pattern: s?.pattern,
      match: s?.match,
      start: s?.start,
      end: s?.end,
    });

    const missing = {
      parentIdLike: 0,
      isGroupMissingOrNotBool: 0,
      locatorMissing: 0, // anchor/pattern/match/start+end
    };

    for (const s of sections) {
      const pid = s?.parentId ?? s?.parent_id ?? null;
      if (!pid) missing.parentIdLike++;
      if (typeof s?.isGroup !== "boolean") missing.isGroupMissingOrNotBool++;

      const hasLocator =
        !!s?.anchor ||
        !!s?.pattern ||
        !!s?.match ||
        (s?.start != null && s?.end != null);
      if (!hasLocator) missing.locatorMissing++;
    }

    return {
      groupsCount: groups.length,
      sectionsCount: sections.length,
      groupIdsPreview: groups.slice(0, 5).map((g: any) => ({
        id: g?.id,
        idType: typeof g?.id,
        title: g?.title,
      })),
      sectionsPreview: sections.slice(0, 8).map(pickSec),
      missing,
      keys: schemaObj && typeof schemaObj === "object" ? Object.keys(schemaObj) : [],
    };
  };

  try {
    // === BREAKPOINT === formData parse boundary
    const tFD = nowMs();
    const fd = await req.formData();
    log(id, `formData parsed`, { ms: nowMs() - tFD });

    const resume = fd.get("resume");
    const schema = fd.get("schema"); // optional

    log(id, `formData keys`, {
      hasResume: resume instanceof File,
      hasSchema: schema instanceof File,
      resumeKind: resume ? (resume as any).constructor?.name : null,
      schemaKind: schema ? (schema as any).constructor?.name : null,
    });

    if (!(resume instanceof File)) {
      warn(id, `missing resume`);
      return NextResponse.json(
        { ok: false, error: "Missing 'resume' file in form-data." },
        { status: 400 }
      );
    }

    // 1) write resume to temp dir
    // === BREAKPOINT === after resume temp write
    const resumePath = await writeTempFile(resume, "resume", id);

    // 2) schema handling
    let schemaPath: string | null = null;
    let schemaName: string | null = null;

    // DEV: keep a tiny in-memory summary for later logging
    let devSchemaSummary: any = null;

    if (schema instanceof File) {
      schemaPath = await writeTempFile(schema, "schema", id);
      schemaName = schema.name || "schema.json";
    }

    // Optional: read schema head for sanity (DEV only)
    if (DEV && schemaPath) {
      try {
        const raw = await fs.readFile(schemaPath, "utf-8");
        log(id, `[schema] tmp file preview`, {
          schemaName,
          schemaPath,
          chars: raw.length,
          head: raw.slice(0, 300),
        });

        // NEW: parse + summarize schema json for contract debugging
        try {
          const parsed = JSON.parse(raw);
          devSchemaSummary = summarizeSchemaJson(parsed);
          log(id, `[schema] json summary`, devSchemaSummary);
        } catch (e: any) {
          warn(id, `[schema] failed to JSON.parse schema`, {
            schemaName,
            schemaPath,
            err: e?.message || String(e),
          });
        }
      } catch (e: any) {
        warn(id, `[schema] failed to read tmp schema`, {
          err: e?.message || String(e),
        });
      }
    }

    // 3) build payload for worker
    const payload: any = { file_path: resumePath };

    if (schemaPath) {
      payload.schema_path = schemaPath;
      payload.schema_name = schemaName;
      payload.fallback = null;
    } else {
      payload.fallback = "headline";
    }

    // NEW: confirm schema temp file exists + size (DEV only)
    if (DEV && schemaPath) {
      try {
        const st = await fs.stat(schemaPath);
        log(id, `[schema] tmp stat`, {
          schemaPath,
          bytes: st.size,
          schemaName,
        });
      } catch (e: any) {
        warn(id, `[schema] tmp stat failed`, {
          schemaPath,
          err: e?.message || String(e),
        });
      }
    }

    log(id, `payload ready`, payload);

    // 4) call worker /parse
    // === BREAKPOINT === right before fetch worker
    const tFetch = nowMs();
    const workerUrl = `${WORKER_BASE}/parse`;

    log(id, `-> worker /parse`, {
      workerUrl,
      // NEW: include schema summary presence (DEV)
      schemaInPayload: !!payload.schema_path,
      schemaSummaryPresent: DEV ? !!devSchemaSummary : undefined,
      schemaSummaryMissingLocator: DEV ? devSchemaSummary?.missing?.locatorMissing : undefined,
    });

    const r = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const dtFetch = nowMs() - tFetch;
    log(id, `<- worker /parse response`, {
      httpStatus: r.status,
      ok: r.ok,
      ms: dtFetch,
      contentType: r.headers.get("content-type"),
    });

    // === BREAKPOINT === after response read
    const { text, json } = await tryReadJson(r, id);

    if (!json) {
      // worker returned non-json
      warn(id, `worker returned non-json`, {
        httpStatus: r.status,
        bodyHead: (text || "").slice(0, 2000),
      });

      return NextResponse.json(
        {
          ok: false,
          error: `Worker /parse returned non-JSON (HTTP ${r.status}).`,
          details: (text || "").slice(0, 2000),
          _worker_http_status: r.status,
        },
        { status: 200 }
      );
    }

    const data = (json || {}) as any;
    data._worker_http_status = r.status;

    // Diagnostics for UI "0 items"
    const sections = data?.sections;
    const sum = summarizeSections(Array.isArray(sections) ? sections : []);
    const rawTextHead = String(data?.raw_text || "")
      .slice(0, 300)
      .replace(/\n/g, "\\n");

    log(id, `worker json summary`, {
      ok: data?.ok,
      error: data?.error,
      rawLen: String(data?.raw_text || "").length,
      rawHead: rawTextHead,
      sectionsSummary: sum,
    });

    // Extra: if ONLY groups returned, warn explicitly
    if (sum.total > 0 && sum.leaves === 0) {
      warn(
        id,
        `WARNING: worker returned only group sections (leaf=0). UI will show "0 items" per group.`,
        {
          groups: sum.groups,
          total: sum.total,
        }
      );
    }

    log(id, `done`, { ms: nowMs() - tAll });

    // Pass-through as 200 so UI can render error in debug panel if needed
    return NextResponse.json(data, { status: 200 });
  } catch (e: any) {
    const isAbort =
      e?.name === "AbortError" ||
      String(e?.message || "").toLowerCase().includes("aborted");

    err(id, `handler error`, {
      isAbort,
      message: e?.message || String(e),
      stack: DEV ? e?.stack : undefined,
    });

    return NextResponse.json(
      {
        ok: false,
        error: isAbort
          ? `Worker /parse timed out after ${WORKER_TIMEOUT_MS}ms`
          : e?.message || "Unknown error in /api/parse/resume.",
      },
      { status: 200 }
    );
  } finally {
    clearTimeout(timeout);
  }
}

