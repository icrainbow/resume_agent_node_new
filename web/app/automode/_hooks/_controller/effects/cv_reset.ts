// web/app/automode/_hooks/_controller/effects/cv_reset.ts
"use client";

import { useEffect } from "react";
import type { Dispatch, State } from "../types";
import { nowIso } from "../../../_utils/utils";

export function useCvSelectionResetEffect(args: {
  st: State;
  dispatch: Dispatch;
  constraintsBaselineRef: React.MutableRefObject<Record<string, string>>;
  defaultNotice: string;

  // NEW: invalidate in-flight parse when user changes resume/schema
  parseTokenRef: React.MutableRefObject<string>;
}) {
  const { st, dispatch, constraintsBaselineRef, defaultNotice, parseTokenRef } =
    args;

  useEffect(() => {
    // Rotate token on ANY resume/schema change to invalidate previous parse responses
    parseTokenRef.current = nowIso();

    if (!st.resumeFile) {
      constraintsBaselineRef.current = {};
      dispatch({
        type: "SET",
        patch: {
          // cancel/clear parse UI
          parseBusy: false,

          sections: [],
          previewUrl: "",
          exportLinks: null,
          jobId: "",
          openById: {},
          openGroups: {},
          cvSectionsConfirmed: false,
          currentSchema: null,
          currentSchemaDebug: null,
          schemaProvidedByUser: false,
          debugReqText: "",
          debugSchemaOld: null,
          debugSchemaNew: null,
          debugPromptText: "",
          notice: defaultNotice,
          chatVisible: false,
          schemaDirty: false,
          pendingRequirements: null,
          schemaRawText: "",
        },
      });
      return;
    }

    constraintsBaselineRef.current = {};
    dispatch({
      type: "SET",
      patch: {
        // cancel/clear parse UI
        parseBusy: false,

        sections: [],
        previewUrl: "",
        exportLinks: null,
        jobId: "",
        openById: {},
        openGroups: {},
        cvSectionsConfirmed: false,
        debugReqText: "",
        debugSchemaNew: null,
        debugPromptText: "",
        notice: `CV selected: ${st.resumeFile.name}. ${
          st.schemaFile
            ? `Schema attached: ${st.schemaFile.name}. Click "Parse CV" to split by schema.`
            : `No schema attached. Click "Parse CV" to parse as single UNKNOWN section (schema optional).`
        }`,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.resumeFile, st.schemaFile]);
}
