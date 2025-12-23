// web/app/automode/_hooks/_controller/useAutoModeController.tsx
"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";

import type {
  DebugEntry,
  ExportResp,
  PdfApiResp,
  Section,
} from "../../_types/types";
import { isValidSchema } from "../../_utils/utils";
import { buildBaselineSchemaFromSections } from "../../_utils/schema";
import { fetchJsonDebug } from "../../_utils/fetch";

import type { ControllerOpts, ControllerRefs, State } from "./types";
import { reducer, DEFAULT_NOTICE } from "./reducer";

import { buildConstraintsBaseline } from "./controller_helpers";

import { ensureJobId as ensureJobIdFn } from "./job";
import * as gates from "./gates";
import * as dbg from "./debug";

// ✅ UI tokens + builders (dedup)
import {
  buildInputsPanelUI,
  buildDebugPanelModel,
  buildDebugPanelUI,
  buildSectionsPanelUI,
  gateDeemphasis as gateDeemphasisFn,
} from "./ui/panel_models";
import {
  BTN_BASE,
  BTN_SM,
  BTN_XS,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_OUTLINE,
} from "./ui/ui_tokens";

// ✅ Effects (moved out)
import { useParseJdEffect } from "./effects/jd";
import { useCvSelectionResetEffect } from "./effects/cv_reset";

// ✅ Actions (moved out)
import { optimizeOneAction, optimizeWholeCVAction } from "./actions/optimize";
import { parseCvAction } from "./actions/parse";
import { handleChatAdjustAction } from "./actions/handleChatAdjust";

import { generateCvDownloadsAction } from "./actions/export";
import { loadUserSchemaFileAction } from "./actions/schema_upload";
import { generatePdfAction, refreshPreviewAction } from "./actions/pdf";

import { devBootstrapAction } from "./actions/dev_bootstrap";

const DEFAULT_NOTICE_LOCAL = DEFAULT_NOTICE;

/**
 * Auto Mode controller (hook)
 * - Owns state + refs
 * - Exposes stable handlers to Page.tsx
 */
export function useAutoModeController(opts: ControllerOpts) {
  const { DEFAULT_WHOLE_CV_NOTES, resumeInputRef, schemaInputRef, jdInputRef } =
    opts;

  const [st, dispatch] = useReducer(reducer, null as any, () => {
    const init: State = {
      resumeFile: null,
      schemaFile: null,
      jdFile: null,
      jdText: "",
      sections: [],
      jobId: "",
      notice: DEFAULT_NOTICE_LOCAL,
      parseBusy: false,
      autoOptimizing: false,
      previewUrl: "",
      previewBusy: false,
      previewDirty: false,
      exportBusy: false,
      exportLinks: null,
      progress: { running: false, current: 0, total: 0 },
      openById: {},
      openGroups: {},
      cvSectionsConfirmed: false,
      chatVisible: false,
      schemaDirty: false,
      pendingRequirements: null,
      currentSchema: null,
      currentSchemaDebug: null,
      schemaProvidedByUser: false,
      schemaRawText: "",
      debugOn: true,
      debugExpanded: true,
      debugEntries: [],
      debugReqText: "",
      debugSchemaOld: null,
      debugSchemaNew: null,
      debugPromptText: "",
      wholeCvNotes: DEFAULT_WHOLE_CV_NOTES,
    };
    return init;
  });

    // ✅ Always-latest state ref (to avoid stale closure in async flows)
  const stRef = useRef<State>(st);
  useEffect(() => {
    stRef.current = st;
  }, [st]);

  /** --------- refs (stable) ---------- */
  const sectionsRef = useRef<Section[]>([]);
  useEffect(() => {
    sectionsRef.current = st.sections;
  }, [st.sections]);

  const schemaRawTextRef = useRef<string>("");
  useEffect(() => {
    schemaRawTextRef.current = st.schemaRawText || "";
  }, [st.schemaRawText]);

  // Step B: jobIdRef (avoid stale closures; always use latest jobId for API payloads)
  const jobIdRef = useRef<string>("");
  useEffect(() => {
    jobIdRef.current = st.jobId || "";
  }, [st.jobId]);

  const jdBaselineRef = useRef<string>("");
  const constraintsBaselineRef = useRef<Record<string, string>>({});
  const wholeCvNotesBaselineRef = useRef<string>(DEFAULT_WHOLE_CV_NOTES);

  // Typed bundle (optional, useful if you later move action fns out of this file)
  const _refs: ControllerRefs = {
    sectionsRef,
    schemaRawTextRef,
    jobIdRef,
    jdBaselineRef,
    constraintsBaselineRef,
    wholeCvNotesBaselineRef,
  };

  /** --------- debug adapter ---------- */
  const pushDebugEntry = (entry: DebugEntry) => {
    dbg.pushDebugEntry(st, dispatch, entry);
  };

  const fetchDbg = useMemo(
    () => ({ debugOn: st.debugOn, pushEntry: pushDebugEntry }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [st.debugOn, st.debugEntries]
  );

  // Step D: ensureJobId must use the ref after dispatching (state update is async)
  const ensureJobId = () => ensureJobIdFn({ st, dispatch, jobIdRef });

  const setNotice = (notice: string) => gates.setNotice(dispatch, notice);

  // Step C: schema commit = validate only (fail-closed), never auto-fix
const commitSchemaCandidateOrBlock = (args: {
  candidate: any;
  source:
    | "user_upload"
    | "parse_baseline"
    | "adjust_structure"
    | "chat"
    | "unknown";
  onAccepted?: (validated: any) => void;
  onBlocked?: (validation: any) => void;
}) => {
  const { candidate, source, onAccepted, onBlocked } = args;

  const wrapped = {
    ...args,

    onAccepted: (validated: any) => {
      console.log("[DEV][SCHEMA COMMIT][ACCEPTED]", {
        source,
        hasGroups: Array.isArray(validated?.groups),
        groups: validated?.groups?.length,
        sections: validated?.sections?.length,
      });
if (process.env.NODE_ENV !== "production") {
  const v = validated ?? candidate; // 看你代码里哪个是最终schema
  const groups = Array.isArray((v as any)?.groups) ? (v as any).groups : [];
  const sections = Array.isArray((v as any)?.sections) ? (v as any).sections : [];

  console.groupCollapsed("[DEBUG][SCHEMA] validated schema detail");
  console.log("groups.length =", groups.length);
  console.log("sections.length =", sections.length);

  // 1) 打印 groups 关键字段 + 类型
  console.table(
    groups.map((g: any, i: number) => ({
      i,
      id: g?.id,
      idType: typeof g?.id,
      title: g?.title,
      anchor: g?.anchor,
      anchorType: typeof g?.anchor,
    }))
  );

  // 2) 打印 leaf sections 关键字段 + 类型 + 可能的契约字段
  console.table(
    sections.map((s: any, i: number) => ({
      i,
      id: s?.id,
      idType: typeof s?.id,
      title: s?.title,
      parentId: s?.parentId ?? s?.parent_id ?? null,
      parentIdType: typeof (s?.parentId ?? s?.parent_id),
      isGroup: s?.isGroup,
      isGroupType: typeof s?.isGroup,
      anchor: s?.anchor,
      start: s?.start,
      end: s?.end,
      match: s?.match,
      pattern: s?.pattern,
    }))
  );

  // 3) 缺失字段统计（用于快速对齐后端契约）
  const missing = {
    parentId: 0,
    isGroup: 0,
    anchorOrPatternOrMatch: 0,
  };

  for (const s of sections) {
    const pid = s?.parentId ?? s?.parent_id ?? null;
    if (!pid) missing.parentId++;
    if (typeof s?.isGroup !== "boolean") missing.isGroup++;

    const hasLocator =
      !!s?.anchor || !!s?.pattern || !!s?.match || (s?.start != null && s?.end != null);
    if (!hasLocator) missing.anchorOrPatternOrMatch++;
  }

  console.log("[DEBUG][SCHEMA] missing summary:", missing);
  console.groupEnd();
}

      if (onAccepted) onAccepted(validated);
    },

    onBlocked: (validation: any) => {
      // 🔴 关键：强制打印可读 JSON
      try {
        console.error(
          "[DEV][SCHEMA COMMIT][BLOCKED JSON]",
          JSON.stringify(validation, null, 2)
        );
      } catch (e) {
        console.error("[DEV][SCHEMA COMMIT][BLOCKED RAW]", validation);
      }

      if (onBlocked) onBlocked(validation);
    },
  };

  const ok = dbg.commitSchemaCandidateOrBlock({
    st,
    dispatch,
    candidate: wrapped.candidate,
    source: wrapped.source,
    onAccepted: wrapped.onAccepted,
    onBlocked: wrapped.onBlocked,
  });

  console.log("[DEV][SCHEMA COMMIT][RETURNED]", ok, { source });
  return ok;
};

  /** --------- gates ---------- */
  const requireJdText = () => gates.requireJdText(st, dispatch);

  const requireCvSectionsConfirmed = () =>
    gates.requireCvSectionsConfirmed(st, dispatch, sectionsRef.current.length);

  /** =========================
   * Schema loader
   * ========================= */
 const loadUserSchemaFile = async (file: File | null) => {
  return loadUserSchemaFileAction({
    file,
    st,
    dispatch,
    commitSchemaCandidateOrBlock,
  });
};

  /** =========================
   * FetchPublicFile for DEV Testing Purpose
   * ========================= */
  async function fetchPublicFileAsFile(
    url: string,
    filename: string,
    mime: string
  ): Promise<File> {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      console.error("[DEV BOOTSTRAP] Cannot find public file", {
        filename,
        url,
        status: r.status,
        statusText: r.statusText,
      });
      throw new Error(`Cannot find public file: ${filename} (GET ${url}, ${r.status})`);
    }
    const blob = await r.blob();
    return new File([blob], filename, { type: mime });
  }


  /** =========================
   * Effects (moved out)
   * ========================= */
  useCvSelectionResetEffect({
    st,
    dispatch,
    constraintsBaselineRef,
    defaultNotice: DEFAULT_NOTICE_LOCAL,
  });

  useParseJdEffect({ st, dispatch, fetchDbg, jdBaselineRef });

  /** =========================
   * Parse CV (moved to action)
   * ========================= */
  const parseCv = async () => {
    return parseCvAction({
      st,
      dispatch,
      setNotice,
      fetchDbg,
      jobIdRef,
      constraintsBaselineRef,
    });
  };

  const devBootstrap = async () => {
  // only allow in dev
  console.log("[DEV][BOOTSTRAP] clicked, NODE_ENV=", process.env.NODE_ENV);

  if (process.env.NODE_ENV !== "development") {
    setNotice("Dev bootstrap is only available in development.");
    return;
  }

  try {
    await devBootstrapAction({
      st,
      dispatch,
      commitSchemaCandidateOrBlock,
      parseCv, // 自动跑 parse；如果你想只加载不 parse，把 parseCv 这行删掉
    });
  } catch (e: any) {
    setNotice(e?.message || "Dev bootstrap failed.");
  }
};

  /** =========================
   * Chat adjust structure (moved to action)
   * ========================= */
  const handleChatAdjust = async () => {
    return handleChatAdjustAction({
      st,
      dispatch,
      setNotice,
      ensureJobId,
      fetchDbg,
      sectionsRef,
      constraintsBaselineRef,
      commitSchemaCandidateOrBlock,
    });
  };

  /** =========================
   * Small UI handlers (keep short)
   * ========================= */
  const onSectionTextChange = (id: string, v: string) => {
    const next = st.sections.map((x) => (x.id === id ? { ...x, text: v } : x));
    dispatch({
      type: "SET",
      patch: { sections: next, previewDirty: true, exportLinks: null },
    });
  };

  const onConstraintChange = (id: string, v: string) => {
    dispatch({
      type: "SET",
      patch: {
        sections: st.sections.map((x) =>
          x.id === id ? { ...x, constraints: v } : x
        ),
      },
    });
  };

  const onMergeReplaceOne = (id: string) => {
    const next = st.sections.map((x) =>
      x.id === id && !x.isGroup && (x.optimizedText || "").trim()
        ? {
            ...x,
            text: x.optimizedText,
            optimizedText: "",
            constraints: "",
            error: undefined,
            optimizing: false,
          }
        : x
    );
    constraintsBaselineRef.current = {
      ...(constraintsBaselineRef.current || {}),
      [id]: "",
    };
    dispatch({
      type: "SET",
      patch: { sections: next, previewDirty: true, exportLinks: null },
    });
  };

  const replaceAll = () => {
    if (!requireCvSectionsConfirmed()) return;

    const next = st.sections.map((s) => {
      if (s.isGroup) return s;
      const opt = (s.optimizedText || "").trim();
      if (!opt) return s;
      return {
        ...s,
        text: opt,
        constraints: "",
        optimizedText: "",
        error: undefined,
        optimizing: false,
      };
    });

    constraintsBaselineRef.current = buildConstraintsBaseline(next, "empty");
    dispatch({
      type: "SET",
      patch: {
        sections: next,
        notice: "Replaced all sections that have optimized content.",
        previewDirty: true,
        exportLinks: null,
      },
    });
  };

  /** =========================
   * Reset all
   * ========================= */
  const resetAll = () => {
    if (resumeInputRef.current) resumeInputRef.current.value = "";
    if (schemaInputRef.current) schemaInputRef.current.value = "";
    if (jdInputRef.current) jdInputRef.current.value = "";

    jdBaselineRef.current = "";
    constraintsBaselineRef.current = {};
    wholeCvNotesBaselineRef.current = DEFAULT_WHOLE_CV_NOTES;
    jobIdRef.current = "";

    dispatch({ type: "RESET_ALL", defaultWholeCvNotes: DEFAULT_WHOLE_CV_NOTES });
  };

  /** =========================
   * Derived (kept outside UI)
   * ========================= */
  const roots = useMemo(
    () => st.sections.filter((s) => !s.parentId),
    [st.sections]
  );

  const childrenByParent = useMemo(() => {
    const m = new Map<string, Section[]>();
    for (const s of st.sections) {
      if (!s.parentId) continue;
      const arr = m.get(s.parentId) ?? [];
      arr.push(s);
      m.set(s.parentId, arr);
    }
    return m;
  }, [st.sections]);

  const jdDirty = useMemo(
    () => st.jdText !== (jdBaselineRef.current ?? ""),
    [st.jdText]
  );

  const wholeCvNotesDirty = useMemo(
    () => st.wholeCvNotes !== (wholeCvNotesBaselineRef.current ?? ""),
    [st.wholeCvNotes]
  );

  const constraintsDirtyById = useMemo(() => {
    const base = constraintsBaselineRef.current || {};
    const map: Record<string, boolean> = {};
    for (const s of st.sections)
      map[s.id] = (s.constraints || "") !== (base[s.id] || "");
    return map;
  }, [st.sections]);

  const anyConstraintsDirty = useMemo(
    () => Object.values(constraintsDirtyById).some(Boolean),
    [constraintsDirtyById]
  );

  const gateDeemphasis = gateDeemphasisFn(!!st.cvSectionsConfirmed);

  /** =========================
   * InputsPanel-facing computed flags (Page expects these names)
   * ========================= */

  /** =========================
   * InputsPanel-facing computed flags (Page expects these names)
   * ========================= */

  const schemaReady = !!st.currentSchema;

  const parseDisabled = useMemo(() => {
    console.log("[DEV][PARSE GATE]", {
      resumeFile: !!st.resumeFile,
      schemaFile: !!st.schemaFile,
      schemaProvidedByUser: st.schemaProvidedByUser,
      currentSchema: !!st.currentSchema,
      parseBusy: st.parseBusy,
    });

    return (
      !st.resumeFile ||
      !st.schemaFile ||
      !schemaReady ||
      st.parseBusy
    );
  }, [
    st.resumeFile,
    st.schemaFile,
    st.schemaProvidedByUser,
    st.currentSchema,
    st.parseBusy,
  ]);

  const jdHint = useMemo(() => {
    if (!st.jdFile && !st.jdText.trim())
      return "Upload a JD (PDF/DOCX/TXT) or paste JD text.";
    if (st.jdFile && !st.jdText.trim()) return "Parsing JD…";
    return "You may edit JD text before optimizing.";
  }, [st.jdFile, st.jdText]);


  const wholeCvDisabled = useMemo(() => {
    if (st.autoOptimizing) return true;
    if (st.parseBusy) return true;
    if (st.previewBusy) return true;
    if (!requireCvSectionsConfirmed()) return true;
    if (!requireJdText()) return true;
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    st.autoOptimizing,
    st.parseBusy,
    st.previewBusy,
    st.cvSectionsConfirmed,
    st.jdText,
    st.sections,
  ]);

  const replaceAllDisabled = useMemo(() => {
    if (!requireCvSectionsConfirmed()) return true;
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.cvSectionsConfirmed, st.sections]);

  /** =========================
   * Sections expand/collapse setters (Page expects setOpenById/setOpenGroups)
   * ========================= */
  const setOpenById = (
    updater:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => {
    const next =
      typeof updater === "function"
        ? (updater as any)(st.openById)
        : updater;
    dispatch({ type: "SET", patch: { openById: next } });
  };

  const setOpenGroups = (
    updater:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => {
    const next =
      typeof updater === "function"
        ? (updater as any)(st.openGroups)
        : updater;
    dispatch({ type: "SET", patch: { openGroups: next } });
  };

  /** =========================
   * Preview / Export
   * ========================= */
  const setPreviewUrl = (v: string) =>
    dispatch({ type: "SET", patch: { previewUrl: v } });

  const refreshPreview = async () => {
  return refreshPreviewAction({ st, dispatch, setNotice });
};


const generatePdf = async () => {
  return generatePdfAction({
    st,
    dispatch,
    setNotice,
    fetchDbg,
    jobIdRef,
    sectionsRef,
    ensureJobId: ensureJobIdFn,
  });
};

  const generateCvDownloads = async () => {
  return generateCvDownloadsAction({
    st,
    dispatch,
    fetchDbg,
    jobIdRef,
    sectionsRef,
  });
};

  /** =========================
   * Optimize (moved to action)
   * ========================= */
  const optimizeOne = async (id: string) => {
    return optimizeOneAction({
      id,
      st,
      dispatch,
      fetchDbg,
      jobIdRef,
      sectionsRef,
    });
  };

  const optimizeWholeCV = async () => {
    return optimizeWholeCVAction({
      st,
      dispatch,
      fetchDbg,
      jobIdRef,
      sectionsRef,
    });
  };

  /** =========================
   * Close section (Page expects onCloseSection)
   * ========================= */
  const onCloseSection = (id: string) => {
    dispatch({
      type: "SET",
      patch: { openById: { ...st.openById, [id]: false } },
    });
  };

  /** =========================
   * Chat update (Page expects handleChatUpdate)
   * ========================= */
  const handleChatUpdate = (patch: any) => {
    if (!patch || typeof patch !== "object") return;

    // Normalize snake_case coming from backend/worker into our State (camelCase)
    const normalized: Partial<State> = {};

    if (typeof patch.pending_requirements !== "undefined") {
      normalized.pendingRequirements = patch.pending_requirements;
    }
    if (typeof patch.schema_dirty !== "undefined") {
      normalized.schemaDirty = !!patch.schema_dirty;
    }
    if (
      typeof patch.assistant_message === "string" &&
      patch.assistant_message.trim()
    ) {
      normalized.notice = patch.assistant_message;
    }

    // If the patch already uses camelCase, allow it too
    if (typeof patch.pendingRequirements !== "undefined") {
      normalized.pendingRequirements = patch.pendingRequirements;
    }
    if (typeof patch.schemaDirty !== "undefined") {
      normalized.schemaDirty = !!patch.schemaDirty;
    }

    dispatch({ type: "SET", patch: normalized });
  };

  /** =========================
   * Models/UI for panels (Page expects these objects)
   * ========================= */
  const inputsPanelUI = useMemo(() => buildInputsPanelUI(), []);
  const debugPanelModel = useMemo(
    () => buildDebugPanelModel(st, dispatch),
    [
      st.debugOn,
      st.debugExpanded,
      st.debugEntries,
      st.debugReqText,
      st.debugSchemaOld,
      st.debugSchemaNew,
      st.debugPromptText,
    ]
  );
  const debugPanelUI = useMemo(() => buildDebugPanelUI(), []);
  const sectionsPanelUI = useMemo(() => buildSectionsPanelUI(), []);

  /** =========================
   * chatSchema (Page expects chatSchema)
   * ========================= */
  const chatSchema = useMemo(() => {
    return (
      st.currentSchemaDebug ??
      st.currentSchema ??
      (st.sections.length ? buildBaselineSchemaFromSections(st.sections) : null)
    );
  }, [st.currentSchemaDebug, st.currentSchema, st.sections]);




  /** =========================
   * Return (must match Page.tsx fields)
   * ========================= */
  return {
    // refs expected by Page
    resumeInputRef,
    schemaInputRef,
    jdInputRef,

    // files/inputs expected by Page
    resumeFile: st.resumeFile,
    schemaFile: st.schemaFile,
    jdFile: st.jdFile,
    jdText: st.jdText,
    jdDirty,
    jdHint,

    // main state expected by Page
    sections: st.sections,
    roots,
    childrenByParent,
    openById: st.openById,
    openGroups: st.openGroups,
    cvSectionsConfirmed: st.cvSectionsConfirmed,

    schemaProvidedByUser: st.schemaProvidedByUser,
    currentSchema: st.currentSchema,

    notice: st.notice,
    jobId: st.jobId,

    parseBusy: st.parseBusy,
    parseDisabled,
    autoOptimizing: st.autoOptimizing,

    previewUrl: st.previewUrl,
    previewDirty: st.previewDirty,
    previewBusy: st.previewBusy,

    exportBusy: st.exportBusy,
    exportLinks: st.exportLinks,

    progress: st.progress,

    schemaDirty: st.schemaDirty,
    pendingRequirements: st.pendingRequirements,
    chatVisible: st.chatVisible,
    chatSchema,

    // style tokens expected by Page
    BTN_BASE,
    BTN_SM,
    BTN_PRIMARY,
    BTN_SECONDARY,
    BTN_OUTLINE,
    gateDeemphasis,

    // derived expected by Page
    constraintsDirtyById,
    anyConstraintsDirty,
    replaceAllDisabled,
    wholeCvDisabled,
    wholeCvNotes: st.wholeCvNotes,
    wholeCvNotesBaselineRef,
    wholeCvNotesDirty,
    DEFAULT_WHOLE_CV_NOTES,

    // panel model/ui expected by Page
    inputsPanelUI,
    debugPanelModel,
    debugPanelUI,
    sectionsPanelUI,

    // stable refs expected by Page
    sectionsRef,

    // setters expected by Page
    setNotice,

    setResumeFile: (f: File | null) => {
      console.log("[setResumeFile]", f?.name, f?.size);
      dispatch({ type: "SET", patch: { resumeFile: f } });
    },

    setJdFile: (f: File | null) => {
      console.log("[setJdFile]", f?.name, f?.size);
      dispatch({ type: "SET", patch: { jdFile: f } });
    },

    setJdText: (v: string) => dispatch({ type: "SET", patch: { jdText: v } }),
    setWholeCvNotes: (v: string) =>
      dispatch({ type: "SET", patch: { wholeCvNotes: v } }),
    setCvSectionsConfirmed: (v: boolean) =>
      dispatch({ type: "SET", patch: { cvSectionsConfirmed: v } }),
    setChatVisible: (v: boolean) =>
      dispatch({ type: "SET", patch: { chatVisible: v } }),
    setSchemaDirty: (v: boolean) =>
      dispatch({ type: "SET", patch: { schemaDirty: v } }),
    setPendingRequirements: (v: any) =>
      dispatch({ type: "SET", patch: { pendingRequirements: v } }),

    setOpenById,
    setOpenGroups,
    setPreviewUrl,

    // actions expected by Page
    loadUserSchemaFile,
    parseCv,
    optimizeWholeCV,
    optimizeOne,
    replaceAll,
    handleChatAdjust,
    generatePdf,
    refreshPreview,
    generateCvDownloads,
    onCloseSection,
    onSectionTextChange,
    onConstraintChange,
    onMergeReplaceOne,
    resetAll,
    handleChatUpdate,
    devBootstrap,

  };
}
