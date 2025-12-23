// web/lib/architect/schema_sanity.ts

export type SchemaGroup = { id: string; title: string };
export type SchemaSection = {
  id: string;
  title: string;
  isGroup?: boolean;
  parentId?: string | null;

  // optional anchors if you later add them
  start?: string;
  end?: string;
};

export type SchemaV1 = {
  version?: string;
  notes?: string;
  groups?: SchemaGroup[];
  sections?: SchemaSection[];
};

export type SanityIssueLevel = "error" | "warn";

export type SanityIssue = {
  level: SanityIssueLevel;
  code:
    | "SCHEMA_NOT_OBJECT"
    | "MISSING_SECTIONS_ARRAY"
    | "MISSING_GROUPS_ARRAY"
    | "EMPTY_SECTION_ID"
    | "EMPTY_SECTION_TITLE"
    | "EMPTY_GROUP_ID"
    | "EMPTY_GROUP_TITLE"
    | "DUP_SECTION_ID"
    | "DUP_GROUP_ID"
    | "GROUP_ID_NOT_IN_GROUPS"
    | "GROUP_ID_NOT_IN_SECTIONS"
    | "SECTION_ID_COLLIDES_WITH_GROUP"
    | "PARENT_NOT_FOUND"
    | "PARENT_NOT_GROUP"
    | "GROUP_SECTION_HAS_PARENT"
    | "NON_GROUP_SECTION_MISSING_ISGROUP"
    | "GROUP_SECTION_MISSING_ISGROUP"
    | "PARENTID_SHOULD_BE_NULL_OR_UNDEFINED"
    | "SECTIONS_NOT_ARRAY"
    | "GROUPS_NOT_ARRAY";
  message: string;
  path?: string;
};

export type SanityResult = {
  ok: boolean;
  issues: SanityIssue[];
  errors: SanityIssue[];
  warnings: SanityIssue[];
  summary: {
    sectionsCount: number;
    groupsCount: number;
    sectionIds: string[];
    groupIds: string[];
  };
};

function isPlainObject(x: unknown): x is Record<string, any> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function normStr(x: any): string {
  return (typeof x === "string" ? x : "").trim();
}

function pushIssue(issues: SanityIssue[], issue: SanityIssue): void {
  issues.push(issue);
}

export function validateSchema(schema: unknown): SanityResult {
  const issues: SanityIssue[] = [];

  if (!isPlainObject(schema)) {
    pushIssue(issues, {
      level: "error",
      code: "SCHEMA_NOT_OBJECT",
      message: "schema must be a plain object",
      path: "",
    });
    return finalize(issues, { sections: [], groups: [] });
  }

  const groupsRaw = (schema as any).groups;
  const sectionsRaw = (schema as any).sections;

  // ---- groups: require array (per your UI requirement)
  if (groupsRaw === undefined) {
    pushIssue(issues, {
      level: "error",
      code: "MISSING_GROUPS_ARRAY",
      message: "schema.groups is missing (required)",
      path: "groups",
    });
  } else if (!Array.isArray(groupsRaw)) {
    pushIssue(issues, {
      level: "error",
      code: "GROUPS_NOT_ARRAY",
      message: "schema.groups must be an array",
      path: "groups",
    });
  }

  // ---- sections: require array (per your UI requirement)
  if (sectionsRaw === undefined) {
    pushIssue(issues, {
      level: "error",
      code: "MISSING_SECTIONS_ARRAY",
      message: "schema.sections is missing (required)",
      path: "sections",
    });
  } else if (!Array.isArray(sectionsRaw)) {
    pushIssue(issues, {
      level: "error",
      code: "SECTIONS_NOT_ARRAY",
      message: "schema.sections must be an array",
      path: "sections",
    });
  }

  const groups: SchemaGroup[] = Array.isArray(groupsRaw) ? groupsRaw : [];
  const sections: SchemaSection[] = Array.isArray(sectionsRaw) ? sectionsRaw : [];

  // validate groups
  const groupIdSeen = new Set<string>();
  const groupIds: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i] as any;
    const id = normStr(g?.id);
    const title = normStr(g?.title);

    if (!id) {
      pushIssue(issues, {
        level: "error",
        code: "EMPTY_GROUP_ID",
        message: `groups[${i}].id is empty`,
        path: `groups[${i}].id`,
      });
      continue;
    }
    if (!title) {
      pushIssue(issues, {
        level: "warn",
        code: "EMPTY_GROUP_TITLE",
        message: `groups[${i}].title is empty`,
        path: `groups[${i}].title`,
      });
    }
    if (groupIdSeen.has(id)) {
      pushIssue(issues, {
        level: "error",
        code: "DUP_GROUP_ID",
        message: `duplicate group id: "${id}"`,
        path: `groups[${i}].id`,
      });
    } else {
      groupIdSeen.add(id);
      groupIds.push(id);
    }
  }

  // validate sections basics + duplicates
  const sectionIdSeen = new Set<string>();
  const sectionIds: string[] = [];

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i] as any;
    const id = normStr(s?.id);
    const title = normStr(s?.title);

    if (!id) {
      pushIssue(issues, {
        level: "error",
        code: "EMPTY_SECTION_ID",
        message: `sections[${i}].id is empty`,
        path: `sections[${i}].id`,
      });
      continue;
    }
    if (!title) {
      pushIssue(issues, {
        level: "warn",
        code: "EMPTY_SECTION_TITLE",
        message: `sections[${i}].title is empty`,
        path: `sections[${i}].title`,
      });
    }

    if (sectionIdSeen.has(id)) {
      pushIssue(issues, {
        level: "error",
        code: "DUP_SECTION_ID",
        message: `duplicate section id: "${id}"`,
        path: `sections[${i}].id`,
      });
    } else {
      sectionIdSeen.add(id);
      sectionIds.push(id);
    }

    // isGroup semantics:
    // - isGroup === true: group section
    // - isGroup === false OR undefined: normal section (do NOT warn)
    // - otherwise: warn (invalid type)
    const isGroupVal = s?.isGroup;
    const isGroup =
      isGroupVal === true ? true : isGroupVal === false || isGroupVal === undefined ? false : false;

    if (isGroupVal !== undefined && typeof isGroupVal !== "boolean") {
      pushIssue(issues, {
        level: "warn",
        code: "NON_GROUP_SECTION_MISSING_ISGROUP",
        message: `sections[${i}].isGroup is invalid for "${id}" (expected boolean)`,
        path: `sections[${i}].isGroup`,
      });
    }

    if (isGroup) {
      if ("parentId" in s && s.parentId != null && normStr(s.parentId) !== "") {
        pushIssue(issues, {
          level: "error",
          code: "GROUP_SECTION_HAS_PARENT",
          message: `group section "${id}" must NOT have parentId`,
          path: `sections[${i}].parentId`,
        });
      }
    }
  }

  // group declarations must match group sections:
  //  - every groups[].id should appear as a section with isGroup:true (recommended -> warn)
  //  - every section with isGroup:true should be present in groups[] (required -> error)
  const groupSectionIds = new Set<string>();
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i] as any;
    if (s?.isGroup === true) {
      const id = normStr(s?.id);
      if (id) groupSectionIds.add(id);
    }
  }

  // groups[] -> should exist in group sections (warn)
  for (const gid of groupIds) {
    if (!groupSectionIds.has(gid)) {
      pushIssue(issues, {
        level: "warn",
        code: "GROUP_ID_NOT_IN_SECTIONS",
        message: `groups contains "${gid}" but sections has no isGroup:true section with same id`,
        path: `groups`,
      });
    }
  }

  // group sections -> must exist in groups[] (error)
  for (const sgid of Array.from(groupSectionIds)) {
    if (!groupIdSeen.has(sgid)) {
      pushIssue(issues, {
        level: "error",
        code: "GROUP_ID_NOT_IN_GROUPS",
        message: `sections has group "${sgid}" but schema.groups does not declare it`,
        path: `sections`,
      });
    }
  }

  // parentId rules
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i] as any;
    const id = normStr(s?.id);
    const isGroup = s?.isGroup === true;

    const parentIdRaw = s?.parentId;
    const parentId =
      parentIdRaw === undefined || parentIdRaw === null ? "" : normStr(parentIdRaw);

    if (isGroup) continue;
    if (!parentId) continue;

    // parent must exist and be group section
    if (!sectionIdSeen.has(parentId)) {
      pushIssue(issues, {
        level: "error",
        code: "PARENT_NOT_FOUND",
        message: `section "${id}" parentId="${parentId}" not found in sections[]`,
        path: `sections[${i}].parentId`,
      });
      continue;
    }

    const parentSection = sections.find((x: any) => normStr(x?.id) === parentId) as any;
    if (!parentSection || parentSection.isGroup !== true) {
      pushIssue(issues, {
        level: "error",
        code: "PARENT_NOT_GROUP",
        message: `section "${id}" parentId="${parentId}" exists but is not isGroup:true`,
        path: `sections[${i}].parentId`,
      });
    }
  }

  // collisions: same id used as group id and also non-group section id
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i] as any;
    const id = normStr(s?.id);
    if (!id) continue;

    if (groupIdSeen.has(id) && s?.isGroup !== true) {
      pushIssue(issues, {
        level: "error",
        code: "SECTION_ID_COLLIDES_WITH_GROUP",
        message: `section "${id}" collides with group id "${id}" but isGroup is not true`,
        path: `sections[${i}]`,
      });
    }
  }

  return finalize(issues, { sections, groups });
}

function finalize(
  issues: SanityIssue[],
  data: { sections: SchemaSection[]; groups: SchemaGroup[] }
): SanityResult {
  const errors = issues.filter((x) => x.level === "error");
  const warnings = issues.filter((x) => x.level === "warn");
  const ok = errors.length === 0;

  return {
    ok,
    issues,
    errors,
    warnings,
    summary: {
      sectionsCount: data.sections.length,
      groupsCount: data.groups.length,
      sectionIds: data.sections.map((s) => normStr((s as any)?.id)).filter(Boolean),
      groupIds: data.groups.map((g) => normStr((g as any)?.id)).filter(Boolean),
    },
  };
}

/**
 * Optional auto-fix: keep your existing version (unchanged)
 */
export function sanitizeSchemaLoose(schema: SchemaV1): {
  schema: SchemaV1;
  removedSectionIds: string[];
  fixed: string[];
} {
  const fixed: string[] = [];
  const removedSectionIds: string[] = [];

  const groups = Array.isArray(schema.groups) ? schema.groups : [];
  const sections = Array.isArray(schema.sections) ? schema.sections : [];

  const seenGroup = new Set<string>();
  const groups2: SchemaGroup[] = [];
  for (const g of groups) {
    const id = normStr((g as any)?.id);
    if (!id) continue;
    if (seenGroup.has(id)) {
      fixed.push(`drop duplicate group "${id}"`);
      continue;
    }
    seenGroup.add(id);
    groups2.push({ id, title: normStr((g as any)?.title) });
  }

  const seenSec = new Set<string>();
  const sections2: SchemaSection[] = [];
  for (const s of sections) {
    const id = normStr((s as any)?.id);
    if (!id) continue;
    if (seenSec.has(id)) {
      removedSectionIds.push(id);
      fixed.push(`drop duplicate section "${id}"`);
      continue;
    }
    seenSec.add(id);
    sections2.push({
      id,
      title: normStr((s as any)?.title),
      isGroup: (s as any)?.isGroup,
      parentId: (s as any)?.parentId ?? undefined,
      start: (s as any)?.start,
      end: (s as any)?.end,
    });
  }

  for (const s of sections2 as any[]) {
    if (s.isGroup === true && s.parentId) {
      s.parentId = undefined;
      fixed.push(`remove parentId on group section "${s.id}"`);
    }
  }

  for (const s of sections2 as any[]) {
    if (s.isGroup === true) continue;
    const pid = normStr(s.parentId);
    if (!pid) {
      s.parentId = undefined;
      continue;
    }
    const parent = sections2.find((x: any) => x.id === pid) as any;
    if (!parent || parent.isGroup !== true) {
      s.parentId = undefined;
      fixed.push(`drop invalid parentId "${pid}" on "${s.id}"`);
    }
  }

  return {
    schema: {
      ...schema,
      groups: groups2,
      sections: sections2,
    },
    removedSectionIds,
    fixed,
  };
}
