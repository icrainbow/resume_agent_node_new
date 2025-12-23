"use client";

import type { Action, State } from "./types";

export const DEFAULT_NOTICE = "Upload CV + Schema, then click Parse CV.";

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "SET":
      return { ...s, ...a.patch };
    case "SET_SECTIONS":
      return {
        ...s,
        sections: a.sections,
        openById: a.openById,
        openGroups: a.openGroups,
        cvSectionsConfirmed: a.confirmed ?? false,
      };
    case "RESET_ALL":
      return {
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
        wholeCvNotes: a.defaultWholeCvNotes,
      };
    default:
      return s;
  }
}
