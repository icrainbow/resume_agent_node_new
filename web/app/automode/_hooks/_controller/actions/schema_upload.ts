"use client";

import { isValidSchema } from "../../../_utils/utils";

import type { Dispatch, State } from "../types";

export async function loadUserSchemaFileAction(args: {
  file: File | null;
  st: State;
  dispatch: Dispatch;
  commitSchemaCandidateOrBlock: (args: {
    candidate: any;
    source:
      | "user_upload"
      | "parse_baseline"
      | "adjust_structure"
      | "chat"
      | "unknown";
    onAccepted?: (validated: any) => void;
    onBlocked?: (validation: any) => void;
  }) => any;
}) {
  const { file, dispatch, commitSchemaCandidateOrBlock } = args;

  dispatch({ type: "SET", patch: { schemaFile: file } });

  if (!file) {
    dispatch({
      type: "SET",
      patch: {
        schemaProvidedByUser: false,
        currentSchema: null,
        currentSchemaDebug: null,
        schemaRawText: "",
        debugReqText: "",
        debugSchemaOld: null,
        debugSchemaNew: null,
        debugPromptText: "",
        schemaDirty: false,
        pendingRequirements: null,
        notice: "Schema cleared. Upload a schema to enable Parse CV.",
      },
    });
    return;
  }

  try {
    const rawText = await file.text();
    dispatch({ type: "SET", patch: { schemaRawText: rawText } });

    let obj: any;
    try {
      obj = JSON.parse(rawText);
    } catch {
      throw new Error("Schema file is not valid JSON.");
    }

    if (!isValidSchema(obj)) {
      dispatch({
        type: "SET",
        patch: {
          schemaProvidedByUser: false,
          notice:
            "Schema file loaded but invalid format (requires { groups:[], sections:[] }).",
        },
      });
      return;
    }

    const normalized = {
      ...obj,
      sections: obj.sections.map((s: any) => ({
        ...s,
        isGroup: typeof s.isGroup === "boolean" ? s.isGroup : false,
      })),
    };

    const accepted = commitSchemaCandidateOrBlock({
      candidate: normalized,
      source: "user_upload",
      onAccepted: (validated) => {
        dispatch({
          type: "SET",
          patch: {
            schemaProvidedByUser: true,
            currentSchema: validated,
            currentSchemaDebug: validated,
            debugSchemaOld: obj,
            debugSchemaNew: null,
            debugReqText: "",
            debugPromptText: "",
            schemaDirty: false,
            pendingRequirements: null,
            notice: `Schema loaded: ${file.name}. Parse CV is now enabled.`,
          },
        });
      },
      onBlocked: () => {
        dispatch({
          type: "SET",
          patch: {
            schemaProvidedByUser: false,
            currentSchema: null,
            currentSchemaDebug: null,
            debugSchemaOld: obj,
            debugSchemaNew: null,
            debugReqText: "",
            debugPromptText: "",
            schemaDirty: false,
            pendingRequirements: null,
          },
        });
      },
    });

    if (!accepted) return;
  } catch (e: any) {
    dispatch({
      type: "SET",
      patch: {
        schemaProvidedByUser: false,
        schemaRawText: "",
        notice: e?.message || "Failed to read schema JSON.",
      },
    });
  }
}
