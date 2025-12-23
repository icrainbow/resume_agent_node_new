"use client";

import type { Dispatch, State } from "../types";
import { isValidSchema } from "../../../_utils/utils";
import { commitSchemaCandidateOrBlock } from "../debug";

export async function loadUserSchemaFileAction(args: {
  file: File | null;
  st: State;
  dispatch: Dispatch;
  setNotice: (s: string) => void;
  setSchemaRawText: (s: string) => void;
}) {
  const { file, st, dispatch, setNotice, setSchemaRawText } = args;

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
    setSchemaRawText(rawText);

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
      sections: (obj.sections || []).map((s: any) => ({
        ...s,
        isGroup: typeof s.isGroup === "boolean" ? s.isGroup : false,
      })),
    };

    const accepted = commitSchemaCandidateOrBlock({
      st,
      dispatch,
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
    setNotice(e?.message || "Failed to read schema JSON.");
    dispatch({
      type: "SET",
      patch: {
        schemaProvidedByUser: false,
        schemaRawText: "",
      },
    });
  }
}
