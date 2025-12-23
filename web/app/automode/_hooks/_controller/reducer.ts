"use client";

import type { Action, State } from "./types";

export const DEFAULT_NOTICE = "Upload CV + Schema, then click Parse CV.";

/**
 * Reducer logging policy:
 * - Default: QUIET (no noisy "[REDUCER] SET" spam).
 * - Optional: enable ONLY high-signal warnings via localStorage flag.
 *
 * Enable high-signal warnings (browser console):
 *   localStorage.setItem("__AUTO_MODE_REDUCER_WARN__", "1"); location.reload();
 * Disable:
 *   localStorage.removeItem("__AUTO_MODE_REDUCER_WARN__"); location.reload();
 */
function shouldWarnReducer(): boolean {
  try {
    if (typeof window !== "undefined") {
      const v = (window as any).localStorage?.getItem(
        "__AUTO_MODE_REDUCER_WARN__"
      );
      return v === "1" || v === "true";
    }
  } catch {
    // ignore
  }
  return false;
}

function summarizeFile(f: any) {
  if (!f) return null;
  return {
    name: (f as any).name,
    size: (f as any).size,
    type: (f as any).type,
  };
}

export function reducer(s: State, a: Action): State {
  // ✅ Hard-disable noisy action-level logs permanently
  // (So other files' logs remain visible and this reducer never spams.)
  const warn = shouldWarnReducer();

  let next: State;

  switch (a.type) {
    case "SET":
      next = { ...s, ...(a as any).patch };
      break;

    case "SET_SECTIONS":
      next = {
        ...s,
        sections: (a as any).sections,
        openById: (a as any).openById,
        openGroups: (a as any).openGroups,
        cvSectionsConfirmed: (a as any).confirmed ?? false,
      };
      break;

    case "RESET_ALL":
      next = {
        ...s,
        resumeFile: null,
        schemaFile: null,
        jdFile: null,
        jdText: "",
        sections: [],
        jobId: "",
        notice: DEFAULT_NOTICE,
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
        debugReqText: "",
        debugSchemaOld: null,
        debugSchemaNew: null,
        debugPromptText: "",
        wholeCvNotes: (a as any).defaultWholeCvNotes,
      };
      break;

    default:
      next = s;
      break;
  }

  // ✅ Optional: keep only high-signal warnings if explicitly enabled
  if (warn) {
    try {
      const prevResume = (s as any).resumeFile;
      const nextResume = (next as any).resumeFile;
      const prevSchema = (s as any).schemaFile;
      const nextSchema = (next as any).schemaFile;
      const prevJdLen = ((s as any).jdText || "").length;
      const nextJdLen = ((next as any).jdText || "").length;

      if (prevResume && !nextResume) {
        // eslint-disable-next-line no-console
        console.warn("[REDUCER][WARN] resumeFile cleared!", {
          from: summarizeFile(prevResume),
          to: summarizeFile(nextResume),
          action: a.type,
        });
      }
      if (prevSchema && !nextSchema) {
        // eslint-disable-next-line no-console
        console.warn("[REDUCER][WARN] schemaFile cleared!", {
          from: summarizeFile(prevSchema),
          to: summarizeFile(nextSchema),
          action: a.type,
        });
      }
      if (prevJdLen > 0 && nextJdLen === 0) {
        // eslint-disable-next-line no-console
        console.warn("[REDUCER][WARN] jdText cleared!", {
          fromLen: prevJdLen,
          toLen: nextJdLen,
          action: a.type,
        });
      }
    } catch {
      // ignore
    }
  }

  return next;
}
