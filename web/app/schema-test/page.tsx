"use client";

import React, { useMemo, useState } from "react";

type UiItem = {
  id: string;
  title: string;
  parentId: string | null;
  isGroup: boolean;
  // 只为展示：schema里的 start/end（可选）
  start?: string;
  end?: string;
};

function safeJsonParse(text: string): { ok: boolean; value?: any; error?: string } {
  try {
    const v = JSON.parse(text);
    return { ok: true, value: v };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Invalid JSON" };
  }
}

/**
 * 宽松校验：允许你的附件 schema 通过
 * - groups: [{id,title}]
 * - sections: [{id,title, parentId?, isGroup? ...}]
 *   - isGroup 可选；若存在必须 boolean
 *   - start/end 可选
 */
function isValidSchemaLoose(x: any): { ok: boolean; error?: string } {
  if (!x || typeof x !== "object") return { ok: false, error: "schema is not an object" };
  if (!Array.isArray(x.groups)) return { ok: false, error: "schema.groups must be an array" };
  if (!Array.isArray(x.sections)) return { ok: false, error: "schema.sections must be an array" };

  for (const g of x.groups) {
    if (!g || typeof g !== "object") return { ok: false, error: "group item is not an object" };
    if (typeof g.id !== "string" || !g.id.trim()) return { ok: false, error: "group.id must be a non-empty string" };
    if (typeof g.title !== "string") return { ok: false, error: "group.title must be a string" };
  }

  for (const s of x.sections) {
    if (!s || typeof s !== "object") return { ok: false, error: "section item is not an object" };
    if (typeof s.id !== "string" || !s.id.trim()) return { ok: false, error: "section.id must be a non-empty string" };
    if (typeof s.title !== "string") return { ok: false, error: "section.title must be a string" };
    if (s.parentId != null && typeof s.parentId !== "string")
      return { ok: false, error: "section.parentId must be string|null|undefined" };
    if (typeof s.isGroup !== "undefined" && typeof s.isGroup !== "boolean")
      return { ok: false, error: "section.isGroup must be boolean if present" };
  }

  return { ok: true };
}

/**
 * normalize：让系统内部永远拿到稳定字段（isGroup 必有，parentId 必有）
 */
function normalizeSchema(x: any) {
  const groups = Array.isArray(x.groups) ? x.groups : [];
  const sections = Array.isArray(x.sections) ? x.sections : [];

  return {
    ...x,
    groups: groups.map((g: any) => ({
      id: String(g?.id ?? "").trim(),
      title: String(g?.title ?? "").trim(),
    })),
    sections: sections.map((s: any) => ({
      ...s,
      id: String(s?.id ?? "").trim(),
      title: String(s?.title ?? "").trim(),
      parentId: s?.parentId != null ? String(s.parentId).trim() : null,
      isGroup: typeof s?.isGroup === "boolean" ? s.isGroup : false,
      start: typeof s?.start === "string" ? s.start : undefined,
      end: typeof s?.end === "string" ? s.end : undefined,
    })),
  };
}

/**
 * 把 schema 变成 UI items（去重/修复版）：
 * 1) groups[] 生成 group nodes（isGroup=true）
 * 2) sections[] 生成 section nodes
 * 3) 关键修复：如果 sections 中存在 “isGroup=true 且 id 同时出现在 groups 里” => 丢弃该 section（避免重复组节点）
 * 4) 兜底：按 id 去重
 * 5) 修复：child 的 parentId 如果指向不存在的 group，则置空
 */
function schemaToUiItems(schema: any): UiItem[] {
  const groups = Array.isArray(schema?.groups) ? schema.groups : [];
  const sections = Array.isArray(schema?.sections) ? schema.sections : [];

  const items: UiItem[] = [];

  // groups 作为 root group nodes
  for (const g of groups) {
    const gid = String(g?.id ?? "").trim();
    if (!gid) continue;
    items.push({
      id: gid,
      title: String(g?.title ?? gid),
      parentId: null,
      isGroup: true,
    });
  }

  const groupIdSet = new Set(items.map((x) => x.id)); // group ids only (for now)

  // sections：先过滤掉 “重复 group 节点”（sections 里 isGroup=true 且 id 在 groups 里）
  const filteredSections = sections.filter((s: any) => {
    const sid = String(s?.id ?? "").trim();
    if (!sid) return false;
    const isGroup = !!s?.isGroup;
    if (isGroup && groupIdSet.has(sid)) {
      // duplicate group node (already represented by schema.groups)
      return false;
    }
    return true;
  });

  for (const s of filteredSections) {
    const sid = String(s?.id ?? "").trim();
    if (!sid) continue;
    items.push({
      id: sid,
      title: String(s?.title ?? sid),
      parentId: s?.parentId ?? null,
      isGroup: !!s?.isGroup,
      start: s?.start,
      end: s?.end,
    });
  }

  // 兜底：按 id 去重（防止同 id 出现多次）
  const seen = new Set<string>();
  const deduped: UiItem[] = [];
  for (const it of items) {
    const id = String(it?.id ?? "").trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push({ ...it, id });
  }

  // 修复：child 的 parentId 如果指向不存在的 group，则置空
  const finalGroupIdSet = new Set(deduped.filter((x) => x.isGroup).map((x) => x.id));
  for (const it of deduped) {
    if (!it.isGroup && it.parentId && !finalGroupIdSet.has(it.parentId)) {
      it.parentId = null;
    }
  }

  return deduped;
}

export default function Page() {
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [schemaText, setSchemaText] = useState<string>(
    `{
  "version": "test_v1",
  "groups": [
    { "id": "professional_experience", "title": "PROFESSIONAL EXPERIENCE" }
  ],
  "sections": [
    { "id": "professional_summary", "title": "PROFESSIONAL SUMMARY", "start": "PROFESSIONAL SUMMARY", "end": "CORE SKILLS" },
    { "id": "core_skills", "title": "CORE SKILLS", "start": "CORE SKILLS", "end": "PROFESSIONAL EXPERIENCE" },

    { "id": "professional_experience", "title": "PROFESSIONAL EXPERIENCE", "isGroup": true },

    { "id": "exp_po", "title": "Product Owner", "parentId": "professional_experience", "start": "Product Owner", "end": "IT Product and Service Manager" },
    { "id": "exp_pm", "title": "IT Product and Service Manager", "parentId": "professional_experience", "start": "IT Product and Service Manager", "end": "Business Analyst" }
  ]
}`
  );

  const [rendered, setRendered] = useState<UiItem[]>([]);
  const [error, setError] = useState<string>("");

  const render = () => {
    setError("");

    const parsed = safeJsonParse(schemaText);
    if (!parsed.ok) {
      setRendered([]);
      setError(`JSON parse error: ${parsed.error}`);
      return;
    }

    const v = isValidSchemaLoose(parsed.value);
    if (!v.ok) {
      setRendered([]);
      setError(`Schema invalid: ${v.error}`);
      return;
    }

    const normalized = normalizeSchema(parsed.value);
    const items = schemaToUiItems(normalized);

    if (!items.length) {
      setRendered([]);
      setError("Schema ok but produced 0 UI items (check ids / arrays).");
      return;
    }

    setRendered(items);
  };

  const roots = useMemo(() => rendered.filter((x) => !x.parentId), [rendered]);

  const childrenByParent = useMemo(() => {
    const m = new Map<string, UiItem[]>();
    for (const it of rendered) {
      if (!it.parentId) continue;
      const arr = m.get(it.parentId) ?? [];
      arr.push(it);
      m.set(it.parentId, arr);
    }
    return m;
  }, [rendered]);

  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-2xl font-semibold">Schema Render Smoke Test</h1>
          <p className="mt-2 text-sm text-slate-600">
            用于验证：你输入的 schema JSON 是否能稳定渲染出 group + sections 结构（与现有 roots/parentId 分组逻辑一致）。
          </p>
        </header>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="text-sm font-semibold">1) Upload CV (mock)</div>
            <div className="mt-3 flex items-center gap-3">
              <input type="file" accept=".pdf,.docx" onChange={(e) => setCvFile(e.target.files?.[0] || null)} />
              <span className="text-sm text-slate-600">{cvFile ? cvFile.name : "No file selected"}</span>
            </div>

            <div className="mt-6 text-sm font-semibold">2) Paste schema JSON</div>
            <textarea
              className="mt-2 h-[24rem] w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs outline-none focus:ring-4 focus:ring-slate-200"
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
            />

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={render}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
              >
                Render Schema
              </button>

              <button
                type="button"
                onClick={() => {
                  setRendered([]);
                  setError("");
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Clear
              </button>
            </div>

            {error && (
              <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-100">
                {error}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="text-sm font-semibold">3) Render Result</div>

            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-slate-200">
              <div>items: {rendered.length}</div>
              <div>roots (!parentId): {roots.length}</div>
              <div>groups (isGroup=true): {rendered.filter((x) => x.isGroup).length}</div>
            </div>

            <div className="mt-4 space-y-4">
              {!rendered.length ? (
                <div className="text-sm text-slate-600">No rendered items yet.</div>
              ) : (
                <>
                  {roots.map((r) => {
                    if (r.isGroup) {
                      const children = childrenByParent.get(r.id) ?? [];
                      return (
                        <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between">
                            <div className="font-semibold">{r.title}</div>
                            <div className="text-xs text-slate-500">{children.length} children</div>
                          </div>
                          {children.length ? (
                            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                              {children.map((c) => (
                                <li key={c.id}>
                                  <span className="font-semibold">{c.title}</span>{" "}
                                  <span className="text-xs text-slate-500">
                                    (id={c.id}, parentId={c.parentId})
                                  </span>
                                  {(c.start || c.end) && (
                                    <div className="mt-1 text-xs text-slate-500">
                                      start={c.start ?? "—"} / end={c.end ?? "—"}
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="mt-3 text-sm text-slate-600">
                              No children matched this groupId. Check child.parentId === "{r.id}".
                            </div>
                          )}
                        </div>
                      );
                    }

                    // root non-group section
                    return (
                      <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="font-semibold">{r.title}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          root section (id={r.id}) — not under any group
                        </div>
                        {(r.start || r.end) && (
                          <div className="mt-2 text-xs text-slate-500">
                            start={r.start ?? "—"} / end={r.end ?? "—"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            <div className="mt-6">
              <div className="text-sm font-semibold">Debug: full items</div>
              <pre className="mt-2 max-h-[18rem] overflow-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-slate-200">
                {rendered.length ? JSON.stringify(rendered, null, 2) : "—"}
              </pre>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
