// web/lib/architect/graph.ts
import type {
  GraphState,
  ArchitectResponse,
  Lang,
  Section,
  NextSuggestedAction,
} from "./contracts";
import { t } from "./copy";

import * as store from "./store";
import { llmAdjustSchema } from "./llm_adjust";

/* =========================
   Utilities
========================= */

function detectLangFromText(text: string): Lang {
  const s = (text || "").trim();
  if (!s) return "zh";
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  return cjk >= Math.max(2, latin) ? "zh" : "en";
}

function sectionsSignature(sections: Section[]): string {
  const base = sections
    .filter((s) => !s.isGroup)
    .map((s) => `${s.id}:${s.title}:${(s.text || "").length}`)
    .join("|");
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return String(h);
}

function safeJsonStringify(x: any) {
  try {
    return JSON.stringify(x);
  } catch {
    return "";
  }
}

function normalizeReqLine(line: string) {
  // ✅ 兼容 store.appendText() 写入的 `${ts}\t${text}`
  // e.g. 2025-12-21T10:11:12.123Z\tadd me a section called poopoo
  return (line || "")
    .replace(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s*\t/,
      ""
    )
    .trim();
}

function normalizeRequirementsText(raw: string): string {
  const lines = (raw || "")
    .split(/\r?\n/)
    .map((l) => normalizeReqLine(l))
    .map((l) => l.trim())
    .filter(Boolean);

  // 去重但保序
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const k = l.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out.join("\n").trim();
}

function safeJsonEqual(a: any, b: any) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * MVP baseline:
 * - each actionable section becomes one group + one child section.
 * NOTE: baseline quality depends on parse quality; this is intentionally simple.
 */
function buildBaselineSchemaFromSections(sections: Section[]) {
  // 1) 全量保留输入 sections（包含 isGroup=true 的 group 节点、已有 parentId 等）
  const src = Array.isArray(sections) ? sections : [];

  // 2) 规范化字段：不“创造” parentId；只做类型修正与默认值
  const outSections = src
    .filter((s: any) => s && typeof s === "object")
    .map((s: any, idx: number) => {
      const id = String(s.id ?? `s_${idx + 1}`).trim();
      const title = String(s.title ?? `SECTION_${idx + 1}`).trim();

      // parentId: only keep if provided; do NOT invent
      let parentId: string | undefined = undefined;
      if (s.parentId != null) {
        parentId = String(s.parentId).trim() || undefined;
      }

      // isGroup: default false, but keep true if explicitly provided
      const isGroup = typeof s.isGroup === "boolean" ? s.isGroup : false;

      // keep start/end if present (your schema uses them for parsing)
      const start = typeof s.start === "string" ? s.start : undefined;
      const end = typeof s.end === "string" ? s.end : undefined;

      return {
        id,
        title,
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
        ...(parentId ? { parentId } : {}), // omit if empty
        isGroup,
      };
    });

  // 3) groups 的生成规则：
  //    - 如果 sections 里本来就有 isGroup=true 的节点：用它们生成 groups（保留 id/title）
  //    - 否则：不要凭空按每个 section 生成 groups；仅返回空 groups
  const groupFromSections = outSections
    .filter((s: any) => !!s.isGroup)
    .map((g: any) => ({
      id: String(g.id),
      title: String(g.title || g.id),
    }));

  // 去重 groups（防止重复 id）
  const seenG = new Set<string>();
  const groups = groupFromSections.filter((g: any) => {
    const id = String(g.id || "");
    if (!id) return false;
    if (seenG.has(id)) return false;
    seenG.add(id);
    return true;
  });

  // 4) 如果存在 groups，则校验 parentId 指向有效 group id；
  //    无效 parentId 直接去掉（避免产生“错误分组”）
  const groupIdSet = new Set(groups.map((g: any) => g.id));
  const finalSections = outSections.map((s: any) => {
    if (s.parentId && !groupIdSet.has(s.parentId)) {
      const { parentId, ...rest } = s;
      return rest;
    }
    return s;
  });

  return {
    version: "baseline_v1",
    notes: "Baseline schema derived from current parsed sections (no invented groups/parentId).",
    groups,
    sections: finalSections,
  };
}


/**
 * Merge strategy placeholder:
 * - 未来支持 “schema_base + change DSL => merged” 时在这里实现真正 merge
 * - 当前先直接以 candidate 作为 merged
 */
function mergeSchema(schemaBase: any, schemaCandidate: any) {
  if (!schemaCandidate) return schemaBase ?? null;
  return schemaCandidate;
}

/* =========================
   Schema -> Sections (crucial)
========================= */

/**
 * Build UI sections from schema:
 * - emits group nodes (isGroup=true) + child nodes in schema order
 * - maps existing section text by id first, then by normalized title
 * - if schema introduces new sections, create empty placeholders (so UI shows them)
 */
function buildSectionsFromSchema(schema: any, existing: Section[]): Section[] {
  const existingById = new Map<string, Section>();
  const existingByTitle = new Map<string, Section>();

  const norm = (s: string) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  for (const s of existing || []) {
    if (!s || s.isGroup) continue;
    if (s.id) existingById.set(String(s.id), s);
    const k = norm(s.title);
    if (k && !existingByTitle.has(k)) existingByTitle.set(k, s);
  }

  const groups: Array<{ id: string; title: string }> = Array.isArray(schema?.groups)
    ? schema.groups
    : [];
  const schemaSections: Array<{ id: string; title: string; parentId?: string | null }> =
    Array.isArray(schema?.sections) ? schema.sections : [];

  const groupById = new Map<string, { id: string; title: string }>();
  for (const g of groups) {
    if (!g?.id) continue;
    groupById.set(String(g.id), { id: String(g.id), title: String(g.title || "") });
  }

  // Group -> children order
  const childrenByGroup: Record<string, Array<any>> = {};
  const rootChildren: Array<any> = [];

  for (const s of schemaSections) {
    if (!s) continue;
    const pid = s.parentId ? String(s.parentId) : "";
    if (pid && groupById.has(pid)) {
      childrenByGroup[pid] = childrenByGroup[pid] || [];
      childrenByGroup[pid].push(s);
    } else {
      rootChildren.push(s);
    }
  }

  const out: Section[] = [];

  // 1) groups in schema.groups order, each followed by its children
  for (const g of groups) {
    if (!g?.id) continue;
    const gid = String(g.id);
    const gTitle = String(g.title || "").trim() || "GROUP";
    out.push({
      id: gid,
      title: gTitle,
      text: "",
      parentId: null,
      isGroup: true,
      constraints: "",
      optimizedText: "",
    });

    const kids = childrenByGroup[gid] || [];
    for (const ks of kids) {
      const sid = String(ks?.id || "");
      const stitle = String(ks?.title || "").trim() || "Section";
      const byId = sid ? existingById.get(sid) : undefined;
      const byTitle = existingByTitle.get(norm(stitle));
      const src = byId || byTitle;

      out.push({
        id: sid || `s_${gid}_${out.length}`,
        title: stitle,
        text: src?.text || "",
        parentId: gid,
        isGroup: false,
        constraints: "",
        optimizedText: "",
      });
    }
  }

  // 2) any root-level sections (no parent group) appended at end
  if (rootChildren.length) {
    for (const rs of rootChildren) {
      const sid = String(rs?.id || "");
      const stitle = String(rs?.title || "").trim() || "Section";
      const byId = sid ? existingById.get(sid) : undefined;
      const byTitle = existingByTitle.get(norm(stitle));
      const src = byId || byTitle;

      out.push({
        id: sid || `s_root_${out.length}`,
        title: stitle,
        text: src?.text || "",
        parentId: null,
        isGroup: false,
        constraints: "",
        optimizedText: "",
      });
    }
  }

  // 3) If schema was empty/invalid, fallback to existing
  if (!out.length) return existing || [];

  return out;
}

/* =========================
   initState
========================= */

/**
 * ✅ 关键修复点：
 * 1) 保留 route.ts 透传的字段（job_id/raw_cv_text/schema_base/messages...）
 * 2) 不允许透传覆盖掉 prevState 的“延续性字段”（history/pending/schema_dirty/...）
 * 3) 同时允许 route.ts 显式传入 pending_requirements/schema_dirty/next_suggested_action 能生效
 */
export function initState(input: {
  action?: "chat" | "adjust_structure" | "reset";
  message: string;
  current: any;
  prevState?: GraphState | null;
  [k: string]: any;
}): GraphState {
  const prev = input.prevState || null;

  const lang =
    detectLangFromText(input.message) ||
    detectLangFromText(safeJsonStringify(input.current || {}));

  // 延续性字段：优先 input（显式覆盖）> prev（延续）> 默认
  const pending_requirements =
    typeof input.pending_requirements === "string"
      ? input.pending_requirements
      : prev?.pending_requirements ?? "";

  const schema_dirty =
    typeof input.schema_dirty === "boolean"
      ? input.schema_dirty
      : prev?.schema_dirty ?? false;

  const next_suggested_action: NextSuggestedAction =
    (input.next_suggested_action as NextSuggestedAction) ??
    (prev?.next_suggested_action as NextSuggestedAction) ??
    "NONE";

  // history：永远只延续 prev 的；避免 input 透传把 history 覆盖掉
  const history = Array.isArray(prev?.history) ? prev!.history : [];

  // stage：延续 prev，否则 START
  const stage = prev?.stage || "START";

  // 透传字段（允许存在，但不应破坏核心字段）
  const passthrough: Record<string, any> = {};
  for (const k of Object.keys(input || {})) {
    if (
      k === "prevState" ||
      k === "message" ||
      k === "current" ||
      k === "pending_requirements" ||
      k === "schema_dirty" ||
      k === "next_suggested_action" ||
      k === "action"
    ) {
      continue;
    }
    passthrough[k] = (input as any)[k];
  }

  return {
    ...(prev || {}),
    ...passthrough,

    // authoritative fields
    lang,
    action: (input.action as any) || prev?.action || "chat",
    stage,
    history,

    userMessage: input.message,
    current: input.current || {},

    lastSectionsSignature: prev?.lastSectionsSignature,
    splitConfirmed: prev?.splitConfirmed ?? false,

    pending_requirements,
    schema_dirty,
    next_suggested_action,

    // debug/audit fields — keep if prev had them unless overwritten later
    current_schema: prev?.current_schema,
    schema_base: (input as any)?.schema_base ?? prev?.schema_base,
    schema_candidate: prev?.schema_candidate,
    adjusted_sections: prev?.adjusted_sections ?? null,
    diff_summary: prev?.diff_summary ?? "",
    warnings: Array.isArray(prev?.warnings) ? prev!.warnings : [],
  } as GraphState;
}

/* =========================
   runArchitect
========================= */

async function ensureBaselinePersisted(jobId: string, sections: Section[]) {
  if (!jobId) return;

  const base = await store.loadJson(jobId, "schema_base.json");
  if (base) return;

  const baseline = buildBaselineSchemaFromSections(sections);
  await store.saveJson(jobId, "schema_base.json", baseline);
  await store.saveJson(jobId, "current_schema.json", baseline);

  const req = await store.loadText(jobId, "requirements.txt");
  if (req == null || req === "") {
    await store.saveText(jobId, "requirements.txt", "");
  }
}

export async function runArchitect(state: GraphState): Promise<ArchitectResponse> {
  const user = (state.userMessage || "").trim();
  const lang = detectLangFromText(user) || state.lang;
  const action = (state.action || "chat") as any;

  const history = [...(state.history || [])];
  if (user) history.push({ role: "user", content: user });

  const sections = Array.isArray(state.current?.sections)
    ? (state.current.sections as Section[])
    : [];

  const jobId = String(state.current?.job_id || (state as any).job_id || "");

  // Ensure baseline schema is persisted once we have a split
  await ensureBaselinePersisted(jobId, sections);

  const actionable = sections.filter((s) => !s.isGroup);
  const sig = actionable.length ? sectionsSignature(actionable) : "";

  if (!actionable.length) {
    const reply = t(lang, "softNoSections");
    history.push({ role: "assistant", content: reply });
    return {
      ok: true,
      message: reply,
      state: {
        ...state,
        lang,
        history,
        userMessage: "",
        pending_requirements: state.pending_requirements ?? "",
        schema_dirty: false,
        next_suggested_action: "NONE",
      },
    };
  }

  if (action === "reset") {
    const reply =
      lang === "zh"
        ? "已重置结构调整记录：requirements 已清空，schema 已回到 baseline。"
        : "Reset done: requirements cleared and schema restored to baseline.";

    if (jobId) {
      await store.resetJob(jobId, { keepSchemaBase: true });
    }

    history.push({ role: "assistant", content: reply });

    return {
      ok: true,
      message: reply,
      state: {
        ...state,
        lang,
        history,
        userMessage: "",
        pending_requirements: "",
        schema_dirty: false,
        next_suggested_action: "NONE",
      },
    };
  }

  /* =====================================================
     CHAT MODE —— 只收集意图，绝不生成 schema
  ===================================================== */
  if (action === "chat") {
    let reply = "";
    let nextAction: NextSuggestedAction = "ASK_MORE";

    // Seed call / initial entry
    if (!user) {
      reply = t(lang, "confirmSplit");
      history.push({ role: "assistant", content: reply });

      return {
        ok: true,
        message: reply,
        state: {
          ...state,
          lang,
          history,
          userMessage: "",
          next_suggested_action: "CLICK_CONFIRM",
        },
      };
    }

    // 用户表达“满意/确认/OK/looks good”
    if (
      /\b(confirm|confirmed|looks good|good|ok|okay|satisfied|fine|yes)\b/i.test(
        user
      ) ||
      /满意|可以|没问题|确认|好|OK|可以了/.test(user)
    ) {
      reply =
        lang === "zh"
          ? "请检查页面 **Sections** 区域的 CV 拆分结果（可点击 **Expand** 展开查看）。\n\n若拆分满意，请点击 **Confirm CV Sections**。\n若需要调整结构，请点击 **Adjust structure**。"
          : "Please review the CV split under **Sections** on the page (you can click **Expand** to inspect details).\n\nIf the split looks good, click **Confirm CV Sections**.\nIf you want to change the structure, click **Adjust structure**.";
      nextAction = "CLICK_CONFIRM";
      history.push({ role: "assistant", content: reply });

      return {
        ok: true,
        message: reply,
        state: {
          ...state,
          lang,
          history,
          userMessage: "",
          next_suggested_action: nextAction,
        },
      };
    }

    // 用户试图“apply / generate”
    if (/apply|generate|update schema|adjust/i.test(user)) {
      if (state.schema_dirty) {
        reply =
          lang === "zh"
            ? "我已记录你的结构调整意图。请点击 **Adjust structure** 来应用这些调整。"
            : "I understand the structural changes. Please click **Adjust structure** to apply them.";
        nextAction = "CLICK_ADJUST";
        history.push({ role: "assistant", content: reply });
        return {
          ok: true,
          message: reply,
          state: {
            ...state,
            lang,
            history,
            userMessage: "",
            next_suggested_action: nextAction,
          },
        };
      }

      reply =
        lang === "zh"
          ? "如果你想调整结构，请告诉我你希望怎么改：\n• 新增/删除哪些 sections\n• 哪些要合并/拆分\n• 希望的顺序（例如 Skills 放在 Experience 前）\n\n我会记录这些偏好；当你准备应用时，请点击 **Adjust structure**。"
          : "If you want to change the structure, tell me what to adjust:\n" +
            "• which sections to add/remove\n" +
            "• which sections to merge/split\n" +
            "• preferred order (e.g. Skills before Experience)\n\n" +
            "I’ll capture your preferences; when you’re ready to apply them, click **Adjust structure**.";
      nextAction = "ASK_MORE";
      history.push({ role: "assistant", content: reply });
      return {
        ok: true,
        message: reply,
        state: {
          ...state,
          lang,
          history,
          userMessage: "",
          next_suggested_action: nextAction,
        },
      };
    }

    // 正常结构性输入 → 累计 requirements（仅记录，不生成 schema）
    if (user.length >= 5) {
      const mergedReq = [state.pending_requirements, user]
        .filter(Boolean)
        .join("\n");

      if (jobId) {
        await store.appendText(jobId, "requirements.txt", user);
        await store.saveText(jobId, "requirements_merged.txt", mergedReq);
      }

      reply =
        lang === "zh"
          ? "收到。我已记录你的结构偏好。\n\n当你准备好应用调整时，请点击 **Adjust structure**。"
          : "Got it. I’ve noted your structural preferences.\n\nWhen you’re ready, click **Adjust structure** to apply them.";
      nextAction = "CLICK_ADJUST";
      history.push({ role: "assistant", content: reply });

      return {
        ok: true,
        message: reply,
        state: {
          ...state,
          lang,
          history,
          userMessage: "",
          pending_requirements: mergedReq,
          schema_dirty: true,
          next_suggested_action: nextAction,
        },
      };
    }

    // fallback
    reply = t(lang, "confirmSplit");
    nextAction = "CLICK_CONFIRM";
    history.push({ role: "assistant", content: reply });

    return {
      ok: true,
      message: reply,
      state: {
        ...state,
        lang,
        history,
        userMessage: "",
        next_suggested_action: nextAction,
      },
    };
  }

  /* =====================================================
     ADJUST MODE —— 唯一允许生成 schema 的地方
  ===================================================== */
  if (action === "adjust_structure") {
    const warnings: string[] = [];

    if (!jobId) {
      const reply =
        lang === "zh"
          ? "当前缺少 job_id，无法加载 schema baseline。请重新 Parse CV。"
          : "Missing job_id. Please parse the CV again.";
      history.push({ role: "assistant", content: reply });
      return {
        ok: true,
        message: reply,
        state: {
          ...state,
          lang,
          history,
          userMessage: "",
          next_suggested_action: "NONE",
        },
      };
    }

    // Prefer persisted schemas
    const persistedCurrent = await store.loadJson(jobId, "current_schema.json");
    const persistedBase = await store.loadJson(jobId, "schema_base.json");

    const schemaForAdjust =
      persistedCurrent ||
      persistedBase ||
      (state as any)?.schema_base ||
      (state.current as any)?.schema_base ||
      null;

    if (!schemaForAdjust) {
      const reply =
        lang === "zh"
          ? "找不到 schema_base/current_schema：请重新 Parse CV。"
          : "Missing schema_base/current_schema. Please parse CV again.";
      history.push({ role: "assistant", content: reply });
      return {
        ok: true,
        message: reply,
        state: {
          ...state,
          lang,
          history,
          userMessage: "",
          next_suggested_action: "NONE",
        },
      };
    }

    // ✅ Source-of-truth: persisted requirements.txt (audit-friendly)
    const persistedReqRaw = (await store.loadText(jobId, "requirements.txt")) || "";
    const reqText = normalizeRequirementsText(
      persistedReqRaw || (state.pending_requirements || "")
    );

    // If no changes, still return baseline/current schema
    if (!state.schema_dirty || !reqText) {
      const reply =
        lang === "zh"
          ? "目前没有可应用的结构改动。\n请先在聊天中描述你希望如何调整 sections，然后再点击 **Adjust structure**。"
          : "No effective structural changes to apply.\nPlease describe what you want to change first, then click **Adjust structure**.";

      history.push({ role: "assistant", content: reply });

      return {
        ok: true,
        message: reply,
        schema: schemaForAdjust,
        state: {
          ...state,
          lang,
          history,
          userMessage: "",
          schema_dirty: false,
          next_suggested_action: "ASK_MORE",
        },
      };
    }

    // Keep base schema in state for diffing
    const schemaBase =
      persistedBase ||
      (state as any)?.schema_base ||
      (state.current as any)?.schema_base ||
      null;

      let schemaCandidate: any = null;
      let llmRaw = "";
      let llmPrompt = ""; // ✅ 新增：用于 debug panel 的 prompt
      
      try {
        const r = await llmAdjustSchema({
          jobId,
          lang,
          schemaBase: schemaForAdjust,
          requirements: reqText,
        });
      
        schemaCandidate = r?.schema ?? null;
        llmRaw = (r?.raw_text || "").toString();
      
        // ✅ 关键补丁：接住 prompt_text
        llmPrompt = (r?.prompt_text || "").toString();
      } catch (e: any) {
        const err = e?.message || String(e);
      
        warnings.push(
          lang === "zh"
            ? `LLM 调整失败，已回退到原 schema。错误：${err}`
            : `LLM adjust failed; fallback to base schema. Error: ${err}`
        );
      
        schemaCandidate = schemaForAdjust; // fallback
      
        // ✅ 失败时也给 prompt 一个可读标记，方便 debug
        llmPrompt = `<<LLM ERROR>> ${err}`;
      }
      

    // Merge (placeholder: currently candidate)
    const merged = mergeSchema(schemaBase, schemaCandidate);

    const schemaChanged =
      schemaBase && merged
        ? !safeJsonEqual(schemaBase, merged)
        : !!schemaCandidate;

    // ✅ KEY FIX:
    // Build adjusted sections from schema so UI actually shows:
    // - new groups/sections
    // - correct parentId mapping
    // - deterministic order
    const finalSections = buildSectionsFromSchema(merged, sections);

    // Persist artifacts
    await store.saveJson(jobId, "schema_candidate.json", schemaCandidate);
    await store.saveJson(jobId, "current_schema.json", merged);

    await store.saveJson(jobId, "schema_adjust_trace.json", {
      ts: new Date().toISOString(),
      jobId,
      requirements: reqText,
      input_schema: schemaForAdjust,
      output_schema: schemaCandidate,
      merged_schema: merged,
      llm_raw: llmRaw?.slice(0, 20000),
    });

    const reply =
      lang === "zh"
        ? "我已根据你的输入生成了新的 sections 结构（schema），并返回给页面。\n请在页面 **Debug / Schema** 区域检查 `schema_candidate / current_schema`；在 **Sections** 区域检查结果。\n若满意，请点击 **Confirm CV Sections**。"
        : "I’ve generated an updated section structure (schema) based on your input and returned it to the page.\n" +
          "Please review `schema_candidate / current_schema` under **Debug / Schema**, and review **Sections**.\n" +
          "If it looks good, click **Confirm CV Sections**.";

    history.push({ role: "assistant", content: reply });

    // Recompute signature based on adjusted actionable sections
    const adjustedActionable = finalSections.filter((s) => !s.isGroup);
    const adjustedSig = adjustedActionable.length
      ? sectionsSignature(adjustedActionable)
      : sig;

    return {
      ok: true,
      message: reply,

      // route.ts 会读取这些字段（或从 state 中读取）
      schema: schemaCandidate,
      schema_candidate: schemaCandidate as any,
      schema_merged: merged as any,
      current_schema: merged as any,
      schema_changed: schemaChanged as any,
      diff_summary: schemaChanged
        ? "schema_base vs current_schema differs (json compare)."
        : "No effective schema change detected.",
      warnings,
      sections: finalSections as any,

      state: {
        ...state,
        lang,
        history,
        userMessage: "",

        // 核心：adjust 完成后清掉 dirty + pending（前端也会清）
        schema_dirty: false,
        pending_requirements: "",

        // schema artifacts（给 Debug Panel）
        schema_base: schemaBase,
        schema_candidate: schemaCandidate,
        current_schema: merged,
        prompt_text: llmPrompt,
        // split artifacts（返回“按 schema 重建的 sections”）
        adjusted_sections: {
          sections: finalSections.map((s) => ({
            id: s.id,
            title: s.title,
            text: s.text,
            parentId: (s as any).parentId ?? null,
            isGroup: !!(s as any).isGroup,
          })),
        },

        diff_summary: schemaChanged
          ? "schema_base vs current_schema differs (json compare)."
          : "No effective schema change detected.",
        warnings,

        splitConfirmed: false,
        lastSectionsSignature: adjustedSig,

        next_suggested_action: "CLICK_CONFIRM",
      },
    };
  }

  /* =========================
     fallback
  ========================= */
  const reply = t(lang, "unknown");
  history.push({ role: "assistant", content: reply });
  return {
    ok: true,
    message: reply,
    state: {
      ...state,
      lang,
      history,
      userMessage: "",
      next_suggested_action: "NONE",
    },
  };
}
