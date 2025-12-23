// web/app/automode/_utils/utils.ts

export function nowIso() {
    return new Date().toISOString();
  }
  
  export function previewText(s: string, n = 900) {
    const t = (s || "").toString();
    return t.length > n ? t.slice(0, n) + "…(truncated)" : t;
  }
  
  
  export function isValidSchema(x: any): boolean {
    // Allow callers to pass raw JSON string (e.g. file content)
    if (typeof x === "string") {
      const s = x.trim();
      if (!s) return false;
      try {
        x = JSON.parse(s);
      } catch {
        return false;
      }
    }
  
    if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  
    // Be tolerant: groups can be missing -> treat as []
    const groups = (x as any).groups ?? [];
    const sections = (x as any).sections;
  
    if (!Array.isArray(groups)) return false;
    if (!Array.isArray(sections)) return false;
  
    for (const g of groups) {
      if (!g || typeof g !== "object" || Array.isArray(g)) return false;
      if (typeof (g as any).id !== "string" || !(g as any).id.trim()) return false;
      // title can be empty string but must be string if present; your file has string titles anyway
      if (typeof (g as any).title !== "string") return false;
    }
  
    for (const s of sections) {
      if (!s || typeof s !== "object" || Array.isArray(s)) return false;
      if (typeof (s as any).id !== "string" || !(s as any).id.trim()) return false;
      if (typeof (s as any).title !== "string") return false;
  
      if ((s as any).parentId != null && typeof (s as any).parentId !== "string")
        return false;
  
      if (
        typeof (s as any).isGroup !== "undefined" &&
        typeof (s as any).isGroup !== "boolean"
      )
        return false;
  
      // Optional anchors: if present, must be strings
      if (typeof (s as any).start !== "undefined" && typeof (s as any).start !== "string")
        return false;
      if (typeof (s as any).end !== "undefined" && typeof (s as any).end !== "string")
        return false;
    }
  
    return true;
  }
  