// web/lib/architect/llm_adjust.ts
type JsonObj = Record<string, any>;

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function isNonEmptyString(x: any): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function normalizeSchemaShape(obj: any): JsonObj {
  const o: any = obj && typeof obj === "object" ? obj : {};
  const groups = Array.isArray(o.groups) ? o.groups : [];
  const sections = Array.isArray(o.sections) ? o.sections : [];

  return {
    ...(o || {}),
    groups: groups
      .filter((g: any) => g && typeof g === "object")
      .map((g: any) => ({
        id: String(g.id ?? ""),
        title: String(g.title ?? ""),
      }))
      .filter((g: any) => isNonEmptyString(g.id) && isNonEmptyString(g.title)),
    sections: sections
      .filter((s: any) => s && typeof s === "object")
      .map((s: any) => ({
        id: String(s.id ?? ""),
        title: String(s.title ?? ""),
        start: typeof s.start === "string" ? s.start : undefined,
        end: typeof s.end === "string" ? s.end : undefined,
        parentId:
          s.parentId == null
            ? undefined
            : typeof s.parentId === "string"
              ? s.parentId
              : String(s.parentId),
        isGroup: typeof s.isGroup === "boolean" ? s.isGroup : false,
      }))
      .filter((s: any) => isNonEmptyString(s.id) && isNonEmptyString(s.title)),
  };
}

/**
 * Merge strategy (deterministic, "base-preserving"):
 * - Start from schemaBase as the source of truth (nothing gets dropped).
 * - Apply modifications from llm schema on top (updates by id).
 * - Append any new groups/sections from llm schema.
 */
function mergeWithBase(schemaBase: JsonObj, llmSchema: JsonObj): JsonObj {
  const base = normalizeSchemaShape(deepClone(schemaBase));
  const incoming = normalizeSchemaShape(llmSchema);

  const out: any = deepClone(base);

  // ---- groups: update existing by id, append new ----
  const baseGroupIndex = new Map<string, number>();
  out.groups = Array.isArray(out.groups) ? out.groups : [];
  for (let i = 0; i < out.groups.length; i++) {
    const id = String(out.groups[i]?.id ?? "");
    if (id) baseGroupIndex.set(id, i);
  }

  for (const g of incoming.groups || []) {
    const id = String(g.id ?? "");
    const title = String(g.title ?? "");
    if (!id || !title) continue;

    const idx = baseGroupIndex.get(id);
    if (typeof idx === "number") {
      // only allow title change; keep id stable
      out.groups[idx] = { ...out.groups[idx], title };
    } else {
      out.groups.push({ id, title });
      baseGroupIndex.set(id, out.groups.length - 1);
    }
  }

  const groupIds = new Set(
    (out.groups || []).map((g: any) => g?.id).filter(Boolean)
  );

  // ---- sections: update existing by id, append new ----
  out.sections = Array.isArray(out.sections) ? out.sections : [];
  const baseSectionIndex = new Map<string, number>();
  for (let i = 0; i < out.sections.length; i++) {
    const id = String(out.sections[i]?.id ?? "");
    if (id) baseSectionIndex.set(id, i);
  }

  for (const s of incoming.sections || []) {
    const id = String(s.id ?? "");
    const title = String(s.title ?? "");
    if (!id || !title) continue;

    const isGroup = !!s.isGroup;
    const parentId = s.parentId != null ? String(s.parentId) : undefined;

    // Parent validation (only if provided)
    if (parentId && !groupIds.has(parentId)) {
      // ignore invalid parentId from model; do NOT break base
      // eslint-disable-next-line no-console
      console.warn("[llm_adjust] ignore invalid parentId from model", {
        id,
        parentId,
      });
    }

    const patch: any = {
      id,
      title,
      isGroup,
      ...(typeof s.start === "string" ? { start: s.start } : {}),
      ...(typeof s.end === "string" ? { end: s.end } : {}),
      ...(parentId && groupIds.has(parentId) ? { parentId } : {}),
    };

    const idx = baseSectionIndex.get(id);
    if (typeof idx === "number") {
      // Update by id; never delete base fields unless explicitly set
      out.sections[idx] = { ...out.sections[idx], ...patch };
    } else {
      out.sections.push(patch);
      baseSectionIndex.set(id, out.sections.length - 1);
    }
  }

  // Keep version stable by default; allow LLM to change only if it clearly sets a non-empty string
  if (typeof llmSchema?.version === "string" && llmSchema.version.trim()) {
    out.version = llmSchema.version.trim();
  }

  return out;
}

/**
 * Hard safety checks:
 * - Must keep ALL base groups + base sections ids
 * - Must keep schema shape {groups, sections}
 */
function assertPreservesBase(base: JsonObj, merged: JsonObj) {
  const b = normalizeSchemaShape(base);
  const m = normalizeSchemaShape(merged);

  const baseGroupIds = new Set((b.groups || []).map((g: any) => g.id));
  const baseSectionIds = new Set((b.sections || []).map((s: any) => s.id));

  const mergedGroupIds = new Set((m.groups || []).map((g: any) => g.id));
  const mergedSectionIds = new Set((m.sections || []).map((s: any) => s.id));

  for (const id of baseGroupIds) {
    if (!mergedGroupIds.has(id))
      throw new Error(`Adjusted schema dropped base group id=${id}`);
  }
  for (const id of baseSectionIds) {
    if (!mergedSectionIds.has(id))
      throw new Error(`Adjusted schema dropped base section id=${id}`);
  }
}

function extractGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  // Some clients/tools wrap as "text"
  if (typeof data?.text === "string" && data.text.trim()) return data.text.trim();
  return "";
}

/**
 * Call Gemini (Google Generative Language API) to adjust schema.
 *
 * Env:
 * - GEMINI_API_KEY (required)
 * - GEMINI_MODEL (optional) e.g. "gemini-1.5-flash" / "gemini-1.5-pro"
 *
 * Notes:
 * - We still deterministically MERGE with schemaBase to prevent accidental drops.
 * - We request JSON output via responseMimeType when supported.
 */
export async function llmAdjustSchema(args: {
    jobId: string;
    lang: "zh" | "en";
    schemaBase: JsonObj;
    requirements: string;
  }): Promise<{ schema: JsonObj; raw_text: string; prompt_text: string }> {
    const apiKey = mustGetEnv("GEMINI_API_KEY");
  
    // ✅ 建议：把默认模型升级到 2.0/2.5 系列（如果你环境已支持）
    // - 你也可以保留 1.5-flash；但 2.x 对 JSON 更稳定
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  
    const { jobId, lang, schemaBase, requirements } = args;
  
    const baseNorm = normalizeSchemaShape(schemaBase);
  
    // ----------------------------
    // ✅ Deterministic: extract explicit removals from requirements
    // ----------------------------
    const removedIds = extractExplicitRemovals(String(requirements || ""), baseNorm);
  
    const system = `
  You are a "Resume Schema Editor".
  
  You will be given:
  1) schema_base (JSON) — this is the SOURCE OF TRUTH and MUST be preserved unless requirements explicitly remove something.
  2) requirements (text) — new change requests.
  
  Hard rules (non-negotiable):
  1) You MUST output a FULL updated schema JSON, NOT a diff.
  2) If a requirement does NOT mention a section/group, keep it unchanged.
  3) Keep the SAME JSON shape/fields as schema_base uses:
     - schema keys: { "version", "groups", "sections" }
     - groups: [{ "id", "title" }]
     - sections: keep existing fields such as { id, title, start, end, parentId, isGroup } if present.
  4) If you add a new section, follow schema_base conventions:
     - Provide: id, title
     - If it is a child under a group, set parentId to an existing groups[].id
     - If it is a top-level section, omit parentId
     - Provide start/end anchors when needed by parsing; keep them as strings.
  5) Output VALID JSON only. No markdown. No explanation.
  
  Goal:
  - Treat schema_base raw JSON as the reference.
  - Apply requirements by ONLY adding/updating/removing what is required, while preserving everything else.
  `.trim();
  
    const user = `
  job_id: ${jobId}
  language: ${lang}
  
  === schema_base (JSON, MUST PRESERVE unless explicitly removed) ===
  ${JSON.stringify(baseNorm, null, 2)}
  
  === requirements (text) ===
  ${String(requirements || "").trim()}
  `.trim();
  
    // ✅ Save prompt for audit/debug panel
    const prompt_text = `=== SYSTEM ===\n${system}\n\n=== USER ===\n${user}`;
  
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { role: "system", parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    });
  
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Gemini error ${resp.status}: ${t}`);
    }
  
    const data = (await resp.json()) as any;
  
    if (data?.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked output: ${String(data.promptFeedback.blockReason)}`);
    }
  
    const rawText = extractGeminiText(data);
  
    const parsed0 = safeJsonParse(rawText);
    if (!parsed0 || typeof parsed0 !== "object") {
      throw new Error(`LLM returned non-JSON or invalid JSON. raw=${rawText?.slice(0, 500)}`);
    }
  
    const parsed = normalizeSchemaShape(parsed0);
    if (!Array.isArray(parsed.groups) || !Array.isArray(parsed.sections)) {
      throw new Error(`LLM schema missing groups/sections arrays. raw=${rawText?.slice(0, 500)}`);
    }
  
    // ✅ Merge with base, BUT allow explicit removals
    const merged = mergeWithBaseAllowRemovals(baseNorm, parsed, removedIds);
  
    // ✅ Assert base preserved, BUT allow explicit removals
    assertPreservesBaseAllowRemovals(baseNorm, merged, removedIds);
  
    return { schema: merged, raw_text: rawText, prompt_text };
  }
  
  /** ---------------------------------------
   * Extract explicit removals from requirements text.
   * Conservative rule:
   * - Only allow removal if requirements contains "remove" and matches a base section id or title token.
   * - This avoids accidental deletions.
   * --------------------------------------*/
  function extractExplicitRemovals(requirements: string, baseNorm: any): Set<string> {
    const txt = (requirements || "").toLowerCase();
  
    const hasRemove = /\bremove\b/.test(txt) || /删除|移除/.test(txt);
    if (!hasRemove) return new Set();
  
    const baseSections: any[] = Array.isArray(baseNorm?.sections) ? baseNorm.sections : [];
    const removed = new Set<string>();
  
    for (const s of baseSections) {
      const id = String(s?.id || "").trim();
      const title = String(s?.title || "").trim();
      if (!id) continue;
  
      const idHit = id && new RegExp(`\\b${escapeRegExp(id.toLowerCase())}\\b`).test(txt);
      const titleHit =
        title && new RegExp(`\\b${escapeRegExp(title.toLowerCase())}\\b`).test(txt);
  
      // extra: common pattern "remove section X"
      const removeSectionHit =
        new RegExp(`remove\\s+section\\s+${escapeRegExp(id.toLowerCase())}`).test(txt) ||
        (title ? new RegExp(`remove\\s+section\\s+.*${escapeRegExp(title.toLowerCase())}`).test(txt) : false);
  
      if (idHit || titleHit || removeSectionHit) {
        // must also mention remove/delete semantics
        if (hasRemove) removed.add(id);
      }
    }
  
    return removed;
  }
  
  function mergeWithBaseAllowRemovals(baseNorm: any, candidate: any, removedIds: Set<string>) {
    const out = normalizeSchemaShape(candidate);
  
    const baseGroups: any[] = Array.isArray(baseNorm?.groups) ? baseNorm.groups : [];
    const baseSections: any[] = Array.isArray(baseNorm?.sections) ? baseNorm.sections : [];
  
    const candGroups: any[] = Array.isArray(out?.groups) ? out.groups : [];
    const candSections: any[] = Array.isArray(out?.sections) ? out.sections : [];
  
    const groupById = new Map<string, any>();
    for (const g of candGroups) groupById.set(String(g?.id ?? ""), g);
  
    // preserve base groups unless candidate has it (no removal logic for groups here; add later if you want)
    const mergedGroups: any[] = [];
    for (const g of baseGroups) {
      const id = String(g?.id ?? "");
      mergedGroups.push(groupById.get(id) ?? g);
    }
    // also keep any new groups candidate added
    for (const g of candGroups) {
      const id = String(g?.id ?? "");
      if (!id) continue;
      if (!mergedGroups.some((x) => String(x?.id ?? "") === id)) mergedGroups.push(g);
    }
  
    const secById = new Map<string, any>();
    for (const s of candSections) secById.set(String(s?.id ?? ""), s);
  
    const mergedSections: any[] = [];
  
    // ✅ preserve base sections unless explicitly removed
    for (const s of baseSections) {
      const id = String(s?.id ?? "");
      if (!id) continue;
      if (removedIds.has(id)) continue; // allow deletion
      mergedSections.push(secById.get(id) ?? s);
    }
  
    // keep candidate-added new sections (but skip ones that candidate includes that are "removed" by requirements)
    for (const s of candSections) {
      const id = String(s?.id ?? "");
      if (!id) continue;
      if (removedIds.has(id)) continue;
      if (!mergedSections.some((x) => String(x?.id ?? "") === id)) mergedSections.push(s);
    }
  
    return {
      ...out,
      groups: mergedGroups,
      sections: mergedSections,
    };
  }
  
  function assertPreservesBaseAllowRemovals(baseNorm: any, merged: any, removedIds: Set<string>) {
    const baseSections: any[] = Array.isArray(baseNorm?.sections) ? baseNorm.sections : [];
    const mergedIds = new Set(
      (Array.isArray(merged?.sections) ? merged.sections : []).map((s: any) => String(s?.id ?? ""))
    );
  
    for (const s of baseSections) {
      const id = String(s?.id ?? "");
      if (!id) continue;
      if (removedIds.has(id)) continue; // ✅ allowed to be missing
      if (!mergedIds.has(id)) {
        throw new Error(`Schema lost base section id="${id}" (not explicitly removed).`);
      }
    }
  }
  
  function escapeRegExp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  
  