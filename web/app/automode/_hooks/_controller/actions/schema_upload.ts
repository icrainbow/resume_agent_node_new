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

  // ===== DEV logs (safe in prod; low volume) =====
  console.log("[schema_upload] loadUserSchemaFileAction called", {
    hasFile: !!file,
    name: file?.name,
    size: file?.size,
    type: file?.type,
  });

  // Always reflect selected file in state first
  dispatch({ type: "SET", patch: { schemaFile: file } });

  if (!file) {
    console.log("[schema_upload] file is null -> clearing schema state");
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
    // Read raw text
    const rawText = await file.text();
    console.log("[schema_upload] schema file read ok", {
      name: file.name,
      rawTextLen: rawText?.length ?? 0,
      head: (rawText || "").slice(0, 120),
    });

    dispatch({ type: "SET", patch: { schemaRawText: rawText } });

    // Parse JSON
    let obj: any;
    try {
      obj = JSON.parse(rawText);
      console.log("[schema_upload] JSON.parse ok", {
        hasGroups: Array.isArray(obj?.groups),
        groupsLen: Array.isArray(obj?.groups) ? obj.groups.length : null,
        hasSections: Array.isArray(obj?.sections),
        sectionsLen: Array.isArray(obj?.sections) ? obj.sections.length : null,
      });
    } catch (err) {
      console.error("[schema_upload] JSON.parse failed", err);
      throw new Error("Schema file is not valid JSON.");
    }

    // Validate shape
    const valid = isValidSchema(obj);
    console.log("[schema_upload] isValidSchema =", valid);

    if (!valid) {
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

    // Normalize isGroup default
    const normalized = {
      ...obj,
      sections: obj.sections.map((s: any) => ({
        ...s,
        isGroup: typeof s.isGroup === "boolean" ? s.isGroup : false,
      })),
    };

    console.log("[schema_upload] normalized schema ready", {
      sectionsLen: Array.isArray(normalized.sections) ? normalized.sections.length : null,
      groupsLen: Array.isArray(normalized.groups) ? normalized.groups.length : null,
    });

    // Commit via fail-closed validator
    console.log("[schema_upload] commitSchemaCandidateOrBlock -> calling");
    const accepted = commitSchemaCandidateOrBlock({
      candidate: normalized,
      source: "user_upload",
      onAccepted: (validated) => {
        console.log("[schema_upload] commit accepted", {
          validatedSectionsLen: Array.isArray(validated?.sections)
            ? validated.sections.length
            : null,
          validatedGroupsLen: Array.isArray(validated?.groups)
            ? validated.groups.length
            : null,
        });

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
      onBlocked: (validation) => {
        console.warn("[schema_upload] commit BLOCKED by validator", validation);

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
            // ✅ 给你一个明确提示，避免看起来“吞了”
            notice:
              "Schema loaded but blocked by validator (commitSchemaCandidateOrBlock). Check Debug Panel / validator logs.",
          },
        });
      },
    });

    console.log("[schema_upload] commitSchemaCandidateOrBlock returned", accepted);

    if (!accepted) return;
  } catch (e: any) {
    console.error("[schema_upload] failed", e);

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
