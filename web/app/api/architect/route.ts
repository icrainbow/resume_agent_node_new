// web/app/api/architect/route.ts
import { NextResponse } from "next/server";
import { initState, runArchitect } from "@/lib/architect/graph";

import * as store from "@/lib/architect/store";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";

type AnyObj = Record<string, any>;

const DEBUG_LOG_PATH = path.join(os.tmpdir(), "architect.debug.log");

function appendDebugFile(line: string) {
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, line + "\n", "utf8");
  } catch {
    // ignore
  }
}

function safeStringify(x: any) {
  try {
    return JSON.stringify(x);
  } catch {
    return "<UNSERIALIZABLE>";
  }
}

function debugHit(req: Request, body: any) {
  const ts = new Date().toISOString();
  const line0 = `[ARCHITECT HIT] ts=${ts} method=${req.method} url=${req.url}`;
  console.error(line0);
  try {
    process.stdout.write(line0 + "\n");
  } catch {}
  appendDebugFile(line0);

  const summary = {
    action: body?.action,
    has_message: typeof body?.message === "string",
    has_messages_array: Array.isArray(body?.messages),
    body_pending_requirements: body?.pending_requirements,
    state_pending_requirements: body?.state?.pending_requirements,
    state_schema_dirty: body?.state?.schema_dirty,
    state_keys: body?.state ? Object.keys(body.state) : null,
    current_job_id: body?.current?.job_id ?? body?.currentSchema?.job_id ?? null,
  };

  const effectiveReq =
    body?.pending_requirements ?? body?.state?.pending_requirements ?? "";

  const line1 = `[ARCHITECT SUMMARY] ${safeStringify(summary)}`;
  const line2 = `[ARCHITECT EFFECTIVE_REQ] ${
    effectiveReq ? effectiveReq : "<EMPTY>"
  }`;

  console.error(line1);
  console.error(line2);
  appendDebugFile(line1);
  appendDebugFile(line2);

  // 注意：body 可能很大；定位完问题建议删掉这一行
  const line3 = `[ARCHITECT BODY] ${safeStringify(body)}`;
  console.error(line3);
  appendDebugFile(line3);

  return { ts, summary, effectiveReq, debug_log_path: DEBUG_LOG_PATH };
}

function pickLastUserMessage(messages: any[] | undefined): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user" && typeof m.content === "string") {
      return m.content;
    }
  }
  return "";
}

function safeJsonEqual(a: any, b: any) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function getJobId(body: AnyObj, currentSchema: AnyObj): string {
  const jid =
    (typeof body?.job_id === "string" && body.job_id) ||
    (typeof body?.current?.job_id === "string" && body.current.job_id) ||
    (typeof body?.currentSchema?.job_id === "string" &&
      body.currentSchema.job_id) ||
    (typeof currentSchema?.job_id === "string" && currentSchema.job_id) ||
    "";
  return jid ? String(jid) : "";
}

function normalizePendingReq(x: any): string {
  if (typeof x === "string") return x;
  if (x == null) return "";
  try {
    return String(x);
  } catch {
    return "";
  }
}

function pickPromptText(x: any): string {
  const v =
    x?.prompt ??
    x?.prompt_text ??
    x?.promptText ??
    x?.debug_prompt ??
    x?.debug?.prompt ??
    x?.state?.prompt ??
    x?.state?.prompt_text ??
    x?.state?.promptText ??
    x?.state?.debug_prompt ??
    x?.state?.debug?.prompt ??
    "";
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/* =========================================================
   ✅ Core fix: apply schema(parentId/order/title) to sections(with text)
========================================================= */

function normalizeSchemaSections(schema: any): Array<{
  id: string;
  title?: string;
  parentId?: string | null;
  isGroup?: boolean;
}> {
  const arr = Array.isArray(schema?.sections) ? schema.sections : [];
  return arr
    .map((s: any) => ({
      id: String(s?.id ?? ""),
      title: typeof s?.title === "string" ? s.title : undefined,
      parentId:
        typeof s?.parentId === "string"
          ? s.parentId
          : s?.parentId == null
          ? null
          : String(s.parentId),
      isGroup: !!s?.isGroup,
    }))
    .filter((s: any) => !!s.id);
}

function applySchemaToSections(params: {
  schema: any;
  currentSections: any[];
  preferSchemaTitle?: boolean;
}): any[] {
  const { schema, currentSections, preferSchemaTitle = true } = params;

  const schemaSections = normalizeSchemaSections(schema);
  const id2parent = new Map<string, string | null>();
  const id2title = new Map<string, string>();
  const id2order = new Map<string, number>();

  schemaSections.forEach((s, idx) => {
    id2parent.set(s.id, s.parentId ?? null);
    if (s.title) id2title.set(s.id, s.title);
    id2order.set(s.id, idx);
  });

  const input = Array.isArray(currentSections) ? currentSections : [];

  // Merge: keep text/constraints/optimizedText etc. from currentSections,
  // but overwrite parentId/title/order based on schema.
  const merged = input.map((sec: any) => {
    const id = String(sec?.id ?? "");
    const next: AnyObj = { ...(sec || {}) };

    if (id && id2parent.has(id)) {
      next.parentId = id2parent.get(id) ?? null;
    } else {
      // keep whatever came from upstream, but normalize undefined -> null
      next.parentId = next.parentId ?? null;
    }

    if (preferSchemaTitle && id && id2title.has(id)) {
      next.title = id2title.get(id);
    }

    return next;
  });

  // Sort to schema order when possible (keeps UI consistent with schema.sections)
  merged.sort((a: any, b: any) => {
    const ao = id2order.get(String(a?.id ?? "")) ?? 9e9;
    const bo = id2order.get(String(b?.id ?? "")) ?? 9e9;
    return ao - bo;
  });

  return merged;
}

function pickBestSchemaForApply(out: any, currentSchemaMerged: any) {
  // Prefer merged/candidate/current_schema in this priority.
  return (
    out?.schema_merged ??
    out?.state?.schema_merged ??
    out?.state?.current_schema ??
    out?.schema_candidate ??
    out?.state?.schema_candidate ??
    out?.schema ??
    currentSchemaMerged ??
    null
  );
}

/* =========================================================
   ✅ Debug helpers: duplicate detection & stage logging
========================================================= */

function findDuplicateIds(list: any[]): string[] {
  try {
    const ids = (Array.isArray(list) ? list : [])
      .map((x: any) => String(x?.id ?? ""))
      .filter(Boolean);
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) dup.add(id);
      else seen.add(id);
    }
    return Array.from(dup);
  } catch {
    return [];
  }
}

function logStageSections(stage: string, list: any[]) {
  try {
    const arr = Array.isArray(list) ? list : [];
    const sample = arr.map((s: any) => ({
      id: String(s?.id ?? ""),
      isGroup: !!s?.isGroup,
      parentId:
        s?.parentId === undefined
          ? "<undef>"
          : s?.parentId === null
          ? null
          : String(s.parentId),
      title: typeof s?.title === "string" ? s.title : undefined,
    }));
    const dup = findDuplicateIds(arr);

    const line = `[ARCHITECT SECTIONS@${stage}] len=${arr.length} dupIds=${safeStringify(
      dup
    )} sample=${safeStringify(sample)}`;
    console.error(line);
    appendDebugFile(line);

    // focus on the known offender id if present
    const focus = arr.filter(
      (x: any) => String(x?.id ?? "") === "professional_experience"
    );
    if (focus.length) {
      const line2 = `[ARCHITECT SECTIONS@${stage}] focus(professional_experience)=${safeStringify(
        focus.map((x: any) => ({
          id: String(x?.id ?? ""),
          isGroup: !!x?.isGroup,
          parentId:
            x?.parentId === undefined
              ? "<undef>"
              : x?.parentId === null
              ? null
              : String(x.parentId),
          title: x?.title,
        }))
      )}`;
      console.error(line2);
      appendDebugFile(line2);
    }
  } catch {
    // ignore
  }
}

/**
 * Dedup by id with rule:
 * - if duplicates exist, prefer isGroup:true
 * - otherwise keep the first occurrence
 *
 * (This preserves insertion order of first-seen ids)
 */
function dedupeSectionsPreferGroup(list: any[]): any[] {
  const applied = Array.isArray(list) ? list : [];

  // group-first dedupe
  const buckets = new Map<string, any[]>();
  for (const s of applied) {
    const id = String(s?.id ?? "");
    if (!id) continue;
    const arr = buckets.get(id) ?? [];
    arr.push(s);
    buckets.set(id, arr);
  }

  const deduped: any[] = [];
  for (const [id, arr] of buckets.entries()) {
    const group = arr.find((x: any) => x?.isGroup === true);
    deduped.push(group ?? arr[0]);
    if (arr.length > 1) {
      console.error("[dup-drop]", id, arr.map((x: any) => x?.isGroup));
    }
  }

  return deduped;
}

/**
 * Backward compatible:
 * Old client payload:
 *   { message, currentSchema, state }
 *
 * MVP payload:
 *   {
 *     job_id,
 *     action: "chat" | "adjust_structure" | "reset",
 *     messages: [...],
 *     raw_cv_text,
 *     schema_base,
 *     pending_requirements,
 *     sections_outline
 *   }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AnyObj;

    // ✅ 强制命中 debug（终端 + /tmp/architect.debug.log）
    const dbg = debugHit(req, body);

    // ✅ 可选：前端/终端临时打一次带 header 的请求，直接回显，确保你“看得见”
    const debugHeader = req.headers.get("x-architect-debug");
    if (debugHeader === "1") {
      return NextResponse.json(
        { ok: true, _debug: dbg, _echo: body },
        {
          headers: {
            "X-Architect-Debug": "HIT",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const action: "chat" | "adjust_structure" | "reset" =
      body?.action === "reset"
        ? "reset"
        : body?.action === "adjust_structure"
        ? "adjust_structure"
        : "chat";

    // Accept both styles:
    // - old: body.message
    // - new: body.messages[] (OpenAI-like)
    const messageFromOld = typeof body?.message === "string" ? body.message : "";
    const messageFromNew = pickLastUserMessage(body?.messages);
    const message = (messageFromNew || messageFromOld || "").toString();

    // Old field: currentSchema
    // New field(s): current (optional)
    const currentSchema = (body?.currentSchema || body?.current || {}) as AnyObj;

    // Old field: state (prev state)
    // New field: prevState (optional) — allow both
    const prevState = (body?.state || body?.prevState || null) as AnyObj | null;

    const job_id = getJobId(body, currentSchema);

    // ---------- requirements resolution ----------
    // Priority:
    // 1) body.pending_requirements
    // 2) body.state.pending_requirements
    // 3) prevState.pending_requirements
    // 4) persisted requirements.txt (if any)
    // 5) ""
    let pending_requirements = normalizePendingReq(
      body?.pending_requirements ??
        body?.state?.pending_requirements ??
        prevState?.pending_requirements ??
        ""
    );

    // If client didn't send it, fall back to persisted file.
    if (!pending_requirements && job_id) {
      const persisted = await store.loadText(job_id, "requirements.txt");
      pending_requirements = normalizePendingReq(persisted);
    }

    // Also accept schema_dirty from body.state, fallback to prevState
    const schema_dirty: boolean =
      typeof body?.state?.schema_dirty === "boolean"
        ? body.state.schema_dirty
        : typeof prevState?.schema_dirty === "boolean"
        ? prevState.schema_dirty
        : false;

    const state = initState({
      action,
      message,

      // keep original fields
      current: currentSchema,
      prevState,

      // MVP contract fields (optional, graph can use if present)
      job_id: job_id || (currentSchema?.job_id ?? ""),
      raw_cv_text: body?.raw_cv_text ?? currentSchema?.raw_cv_text ?? "",
      schema_base: body?.schema_base ?? currentSchema?.schema_base ?? null,

      pending_requirements,
      schema_dirty,

      sections_outline: body?.sections_outline ?? null,

      // also pass the full chat messages if you want richer intent detection
      messages: Array.isArray(body?.messages) ? body.messages : null,
    } as any);

    const out = await runArchitect(state);

    // =========================================================
    // ✅ 调试：graph 输出里是否带 prompt 字段（给你对齐前端 debug panel）
    // =========================================================
    const outPromptText = pickPromptText(out);
    const lineP0 = `[ARCHITECT OUT] keys=${safeStringify(Object.keys(out || {}))}`;
    const lineP1 = `[ARCHITECT OUT] sample=${safeStringify({
      ok: out?.ok,
      hasPrompt: !!outPromptText,
      promptLen: outPromptText ? outPromptText.length : 0,
      hasState: !!out?.state,
      stateKeys: out?.state ? Object.keys(out.state) : null,
    })}`;
    console.error(lineP0);
    console.error(lineP1);
    appendDebugFile(lineP0);
    appendDebugFile(lineP1);
    if (outPromptText) {
      const lineP2 = `[ARCHITECT OUT] prompt_preview=${safeStringify(
        outPromptText.slice(0, 500)
      )}`;
      console.error(lineP2);
      appendDebugFile(lineP2);
    }

    // ---- Current schema (for Debug Panel: "Current schema") ----
    const currentSchemaMerged =
      out?.state?.current_schema ??
      out?.state?.schema_base ??
      out?.state?.current?.schema_base ??
      out?.schema_merged ??
      out?.schema ??
      null;

    // Backward-compatible response fields
    const resp: AnyObj = {
      ok: true,

      // old contract
      message: out?.message ?? "",
      schema: out?.schema ?? null,
      state: out?.state ?? null,

      // MVP contract (new)
      assistant_message: out?.message ?? "",
      pending_requirements: out?.state?.pending_requirements ?? "",
      schema_dirty:
        typeof out?.state?.schema_dirty === "boolean"
          ? out.state.schema_dirty
          : false,
      next_suggested_action:
        (out?.state?.next_suggested_action as string) ??
        (out?.next_suggested_action as string) ??
        "NONE",

      // ✅ prompt_text 返回给前端 debug panel
      prompt_text: outPromptText,

      // Debug panel third column should display this
      current_schema: currentSchemaMerged,

      // Optional, helpful debug metadata
      _meta: {
        action,
        stage: out?.state?.stage ?? null,
        job_id:
          out?.state?.current?.job_id ??
          out?.state?.job_id ??
          job_id ??
          body?.job_id ??
          currentSchema?.job_id ??
          "",
      },
    };

    /**
     * If adjust_structure path produced artifacts, expose them in the response.
     * Also persist them for audit and for the next adjust call.
     */
    if (action === "adjust_structure") {
      const schemaCandidate =
        out?.schema_candidate ?? out?.state?.schema_candidate ?? out?.schema ?? null;

      const schemaBase =
        body?.schema_base ??
        currentSchema?.schema_base ??
        out?.state?.schema_base ??
        out?.state?.current?.schema_base ??
        null;

      const schemaChanged =
        typeof out?.schema_changed === "boolean"
          ? out.schema_changed
          : schemaBase && schemaCandidate
          ? !safeJsonEqual(schemaCandidate, schemaBase)
          : !!schemaCandidate;

      resp.schema_candidate = schemaCandidate;
      resp.diff_summary = out?.diff_summary ?? out?.state?.diff_summary ?? "";
      resp.warnings = out?.warnings ?? out?.state?.warnings ?? [];
      resp.schema_changed = schemaChanged;

      // If your graph already returns the merged schema, prefer exposing it explicitly too
      resp.schema_merged =
        out?.schema_merged ??
        out?.state?.schema_merged ??
        out?.state?.current_schema ??
        currentSchemaMerged ??
        schemaCandidate ??
        null;

      // Keep current_schema in sync with merged result for the debug panel
      resp.current_schema = resp.schema_merged ?? resp.current_schema ?? null;

      // ---------------------------------------------------------
      // ✅ ✅ ✅ Critical: return "sections with text" AND apply schema parentId/order
      // ---------------------------------------------------------
      const baseSectionsWithText =
        // highest priority: graph already produced sections
        out?.sections ??
        out?.state?.sections ??
        // fallback: currentSchema.sections from client payload
        currentSchema?.sections ??
        body?.current?.sections ??
        [];

      // Stage log: upstream sections before schema apply
      logStageSections("A_baseSectionsWithText", baseSectionsWithText);

      const schemaForApply = pickBestSchemaForApply(out, resp.current_schema);

      // Stage log: schema chosen for apply (sections only; keep log small)
      try {
        const schemaSec = Array.isArray(schemaForApply?.sections)
          ? schemaForApply.sections.map((s: any) => ({
              id: String(s?.id ?? ""),
              isGroup: !!s?.isGroup,
              parentId:
                s?.parentId === undefined
                  ? "<undef>"
                  : s?.parentId === null
                  ? null
                  : String(s.parentId),
              title: s?.title,
            }))
          : null;
        const lineS = `[ARCHITECT SCHEMA_FOR_APPLY] hasSchema=${!!schemaForApply} schemaSections=${safeStringify(
          schemaSec
        )}`;
        console.error(lineS);
        appendDebugFile(lineS);
      } catch {}

      // If schema exists, apply it; otherwise pass through.
      const appliedSections = schemaForApply
        ? applySchemaToSections({
            schema: schemaForApply,
            currentSections: baseSectionsWithText,
            preferSchemaTitle: true,
          })
        : Array.isArray(baseSectionsWithText)
        ? baseSectionsWithText
        : [];

      // Stage log: after schema apply (this is where your duplicate often appears)
      logStageSections("B_appliedSections", appliedSections);

      // ✅ Dedup with preference to isGroup:true (bucket approach)
      const deduped = dedupeSectionsPreferGroup(appliedSections);

      // Stage log: after dedupe
      logStageSections("C_dedupedSections", deduped);

      // Return to client (Page.tsx should setSections(resp.sections))
      resp.sections = deduped;

      // Also put into state (so your debug panel / future steps can read it)
      if (resp.state && typeof resp.state === "object") {
        // ✅ 建议：state 里也放 deduped，避免前端读到重复
        resp.state.adjusted_sections = { sections: deduped };

        // ✅ 仍然保留一份 raw（可选，用于诊断；不想要可以删）
        resp.state.adjusted_sections_raw = { sections: appliedSections };

        if (typeof resp.state.prompt_text !== "string") {
          resp.state.prompt_text = outPromptText;
        }
      }

      // ✅ ✅ ✅ Persist artifacts (fastest "schema persistence" with audit)
      const jid = resp._meta?.job_id ? String(resp._meta.job_id) : "";
      if (jid) {
        // Always persist base if missing (defensive)
        const base = await store.loadJson(jid, "schema_base.json");
        if (!base && schemaBase) {
          await store.saveJson(jid, "schema_base.json", schemaBase);
        }

        if (schemaCandidate) {
          await store.saveJson(jid, "schema_candidate.json", schemaCandidate);
        }
        if (resp.schema_merged) {
          await store.saveJson(jid, "current_schema.json", resp.schema_merged);
        }

        // Also persist a quick snapshot of the requirements used for this adjust
        const usedReq = normalizePendingReq(
          body?.pending_requirements ??
            body?.state?.pending_requirements ??
            pending_requirements ??
            ""
        );
        if (usedReq) {
          await store.saveText(jid, "requirements_merged.txt", usedReq);
        }

        // ✅ optional: persist prompt
        if (outPromptText) {
          await store.saveText(jid, "debug_prompt.txt", outPromptText);
        }
      }

      // After a successful adjust, schema_dirty should be false.
      if (schemaChanged) resp.schema_dirty = false;
    }

    return NextResponse.json(resp, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    return NextResponse.json(
      {
        ok: false,

        // backward compat
        message: `Server error: ${msg}`,
        schema: null,
        state: {
          lang: "en",
          stage: "START",
          history: [{ role: "assistant", content: `Server error: ${msg}` }],
          userMessage: "",
          current: {},
        },

        // MVP fields (safe defaults)
        assistant_message: `Server error: ${msg}`,
        pending_requirements: null,
        schema_dirty: false,
        next_suggested_action: "NONE",

        // ✅ prompt fallback
        prompt_text: "",

        // debug panel third column
        current_schema: null,

        // adjust artifacts defaults
        schema_candidate: null,
        schema_merged: null,
        sections: null,
        diff_summary: "",
        warnings: [],
        schema_changed: false,
      },
      { status: 500 }
    );
  }
}
