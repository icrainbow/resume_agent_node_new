// web/app/automode/_controller/controller_helpers.ts
import type { Section, ParseResp } from "../../_types/types";

/** --------- tiny utils ---------- */

export function newJobId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export function normalizePendingReq(v: any): string {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  try {
    return JSON.stringify(v);
  } catch {
    try {
      return String(v);
    } catch {
      return "";
    }
  }
}

/** --------- parse/apply ---------- */

export function mapParseRespToSections(data: ParseResp): Section[] {
  return (data.sections || []).map((s: any) => ({
    id: String(s.id ?? ""),
    title: String(s.title ?? ""),
    text: String(s.text ?? ""),
    parentId: s.parentId ?? null,
    isGroup: !!s.isGroup,
    constraints: "",
    optimizedText: "",
    error: undefined,
  }));
}

export function buildOpenMaps(sections: Section[]) {
  const openGroups: Record<string, boolean> = {};
  const openById: Record<string, boolean> = {};
  for (const s of sections) {
    if (s.isGroup) openGroups[s.id] = true;
    else openById[s.id] = false;
  }
  return { openGroups, openById };
}

export function buildConstraintsBaseline(sections: Section[], mode: "empty" | "keepConstraints") {
  const base: Record<string, string> = {};
  for (const s of sections) {
    if (s.isGroup) continue;
    base[s.id] = mode === "keepConstraints" ? (s.constraints || "") : "";
  }
  return base;
}

/** --------- backend field pickers ---------- */

export function pickReqTextFromBackend(data: any): string | null {
  const v =
    data?.requirements_txt ??
    data?.requirements_text ??
    data?.requirements ??
    data?.req_text ??
    data?.reqText ??
    data?.state?.requirements ??
    data?.state?.reqText ??
    null;
  return typeof v === "string" ? v : null;
}

export function pickPromptFromBackend(data: any): string | null {
  const v =
    data?.prompt ??
    data?.prompt_text ??
    data?.promptText ??
    data?.llm_prompt ??
    data?.llm_prompt_text ??
    data?.debug?.prompt ??
    data?.debug?.llm_prompt ??
    data?.state?.prompt ??
    null;
  return typeof v === "string" ? v : null;
}

export function pickNextSchemaFromBackend(data: any) {
  return (
    data?.current_schema ||
    data?.schema_merged ||
    data?.schema_candidate ||
    data?.schema ||
    data?.state?.current_schema ||
    null
  );
}

export function pickSchemaBaseFromBackend(data: any) {
  return data?.schema_base ?? data?.state?.schema_base ?? data?.state?.schemaBase ?? null;
}

export function pickSectionsFromBackend(data: any): any[] | null {
  if (Array.isArray(data?.sections)) return data.sections;
  if (Array.isArray(data?.state?.adjusted_sections?.sections)) return data.state.adjusted_sections.sections;
  if (Array.isArray(data?.adjusted_sections?.sections)) return data.adjusted_sections.sections;
  return null;
}

export function mapBackendSectionsToSections(arr: any[]): Section[] {
  return arr.map((s: any) => ({
    id: String(s.id ?? ""),
    title: String(s.title ?? ""),
    text: String(s.text ?? ""),
    parentId: s.parentId ?? null,
    isGroup: !!s.isGroup,
    constraints: "",
    optimizedText: "",
    error: undefined,
  }));
}
