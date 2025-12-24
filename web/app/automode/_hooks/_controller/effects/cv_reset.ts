// web/app/automode/_hooks/_controller/effects/cv_reset.ts
"use client";

import { useEffect } from "react";

import type { Dispatch, State } from "../types";

export function useCvSelectionResetEffect(args: {
  st: State;
  dispatch: Dispatch;
  constraintsBaselineRef: React.MutableRefObject<Record<string, string>>;
  defaultNotice: string;
}) {
  const { st, dispatch, constraintsBaselineRef, defaultNotice } = args;

  useEffect(() => {
    if (!st.resumeFile) {
      constraintsBaselineRef.current = {};
      dispatch({
        type: "SET",
        patch: {
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
