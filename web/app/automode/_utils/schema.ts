// web/app/automode/_utils/schema.ts

import type { Section } from "../_types/types";

export function buildBaselineSchemaFromSections(sections: Section[]) {
  const src = Array.isArray(sections) ? sections : [];
  const normTitle = (t: any) => String(t ?? "").trim();

  const groupsFromUI = src.filter((s) => !!s.isGroup);
  const nonGroups = src.filter((s) => !s.isGroup);

  const schema: any = {
    version: 1,
    notes: "Baseline schema generated from current CV split.",
    groups: [] as Array<{ id: string; title: string }>,
    sections: [] as Array<{
      id: string;
      title: string;
      parentId?: string | null;
      isGroup: boolean;
    }>,
  };

  const groupIdSet = new Set<string>();
  const sectionIdSet = new Set<string>();

  const addGroup = (idRaw: any, titleRaw: any) => {
    const id = String(idRaw ?? "").trim();
    if (!id || groupIdSet.has(id)) return;
    groupIdSet.add(id);
    schema.groups.push({ id, title: normTitle(titleRaw) || id });
  };

  const addSection = (s: any, parentId: string | null) => {
    const id = String(s?.id ?? "").trim();
    if (!id || sectionIdSet.has(id)) return;
    sectionIdSet.add(id);
    schema.sections.push({
      id,
      title: normTitle(s?.title) || "SECTION",
      parentId,
      isGroup: false,
    });
  };

  if (groupsFromUI.length) {
    for (const g of groupsFromUI) addGroup(g.id, g.title);

    for (const s of nonGroups) {
      const pid = s.parentId ? String(s.parentId).trim() : "";
      addSection(s, pid && groupIdSet.has(pid) ? pid : null);
    }
    return schema;
  }

  const referencedParentIds = new Set<string>();
  for (const s of nonGroups) {
    const pid = s.parentId ? String(s.parentId).trim() : "";
    if (pid) referencedParentIds.add(pid);
  }

  const byId = new Map<string, any>();
  for (const s of src) {
    const sid = String(s?.id ?? "").trim();
    if (sid) byId.set(sid, s);
  }

  for (const gid of referencedParentIds) {
    const maybe = byId.get(gid);
    addGroup(gid, maybe?.title ?? gid);
  }

  for (const s of nonGroups) {
    const pid = s.parentId ? String(s.parentId).trim() : "";
    addSection(s, pid && groupIdSet.has(pid) ? pid : null);
  }

  return schema;
}

export function materializeSectionsFromSchema(
  schema: any,
  prevSections: Section[]
): Section[] | null {
  const schemaSections = Array.isArray(schema?.sections) ? schema.sections : [];
  const schemaGroups = Array.isArray(schema?.groups) ? schema.groups : [];

  if (!schemaSections.length && !schemaGroups.length) return null;

  const prevById = new Map<string, Section>();
  for (const s of prevSections || []) prevById.set(String(s.id), s);

  const next: Section[] = [];

  for (const g of schemaGroups) {
    const id = String(g?.id ?? g?.title ?? "");
    if (!id) continue;
    const old = prevById.get(id);
    next.push({
      id,
      title: String(g?.title ?? old?.title ?? "Group"),
      text: "",
      parentId: null,
      isGroup: true,
      constraints: "",
      optimizedText: "",
    });
  }

  for (const s of schemaSections) {
    const id = String(s?.id ?? "");
    if (!id) continue;
    const old = prevById.get(id);
    next.push({
      id,
      title: String(s?.title ?? old?.title ?? "Section"),
      text: String(old?.text ?? ""),
      parentId: s?.parentId ?? old?.parentId ?? null,
      isGroup: false,
      constraints: String(old?.constraints ?? ""),
      optimizedText: String(old?.optimizedText ?? ""),
      optimizing: false,
      error: undefined,
    });
  }

  const groupIdSet = new Set(next.filter((x) => x.isGroup).map((x) => x.id));
  for (const item of next) {
    if (!item.isGroup && item.parentId && !groupIdSet.has(item.parentId)) {
      item.parentId = null;
    }
  }

  return next.length ? next : null;
}
