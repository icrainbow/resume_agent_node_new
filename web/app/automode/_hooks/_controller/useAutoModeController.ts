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
    return dbg.commitSchemaCandidateOrBlock({
      st,
      dispatch,
      candidate,
      source,
      onAccepted,
      onBlocked,
    });
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
  const parseDisabled = useMemo(() => {
    if (st.parseBusy) return true;
    if (!st.resumeFile) return true;
    if (!st.schemaFile) return true;
    if (!st.schemaProvidedByUser) return true;
    return false;
  }, [st.parseBusy, st.resumeFile, st.schemaFile, st.schemaProvidedByUser]);

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
    setResumeFile: (f: File | null) =>
      dispatch({ type: "SET", patch: { resumeFile: f } }),
    setJdFile: (f: File | null) =>
      dispatch({ type: "SET", patch: { jdFile: f } }),
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
  };
}
