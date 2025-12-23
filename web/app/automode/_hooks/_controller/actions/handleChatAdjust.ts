"use client";

import type { Dispatch, State } from "../types";

import type { Section } from "../../../_types/types";
import { nowIso } from "../../../_utils/utils";
import {
  buildBaselineSchemaFromSections,
  materializeSectionsFromSchema,
} from "../../../_utils/schema";
import { fetchJsonDebug } from "../../../_utils/fetch";

import {
  normalizePendingReq,
  buildOpenMaps,
  buildConstraintsBaseline,
  pickReqTextFromBackend,
  pickPromptFromBackend,
  pickNextSchemaFromBackend,
  pickSchemaBaseFromBackend,
  pickSectionsFromBackend,
  mapBackendSectionsToSections,
} from "../controller_helpers";

export async function handleChatAdjustAction(args: {
  st: State;
  dispatch: Dispatch;

  // deps from controller
  setNotice: (s: string) => void;
  ensureJobId: () => string;
  fetchDbg: { debugOn: boolean; pushEntry: (e: any) => void };

  sectionsRef: React.MutableRefObject<Section[]>;
  constraintsBaselineRef: React.MutableRefObject<Record<string, string>>;

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
  }) => boolean;
}) {
  const {
    st,
    dispatch,
    setNotice,
    ensureJobId,
    fetchDbg,
    sectionsRef,
    constraintsBaselineRef,
    commitSchemaCandidateOrBlock,
  } = args;

  if (!sectionsRef.current.length) {
    setNotice("Please parse the CV first.");
    return;
  }

  dispatch({
    type: "SET",
    patch: {
      cvSectionsConfirmed: false,
      previewDirty: true,
      exportLinks: null,
      notice: "Adjust structure triggered. Calling backend…",
    },
  });

  try {
    const jid = ensureJobId();
    const pendingReqStr = normalizePendingReq(st.pendingRequirements);

    // ===== B1 debug logs (temporary) =====
    console.log("[architect] st.pendingRequirements =", st.pendingRequirements);
    console.log("[architect] pendingReqStr =", pendingReqStr);
    // =====================================

    const oldSchemaSnapshot =
      (st.schemaProvidedByUser ? st.currentSchema : null) ??
      st.debugSchemaOld ??
      st.currentSchemaDebug ??
      st.currentSchema ??
      buildBaselineSchemaFromSections(sectionsRef.current);

    dispatch({
      type: "SET",
      patch: {
        debugSchemaOld: oldSchemaSnapshot,
        debugSchemaNew: null,
        debugReqText: pendingReqStr || "",
        debugPromptText: "",
      },
    });

    const payload = {
      action: "adjust_structure",
      ts: nowIso(),
      pending_requirements: pendingReqStr,
      schema_raw: oldSchemaSnapshot ?? null,
      schema_provided_by_user: !!st.schemaProvidedByUser,
      current: {
        job_id: jid,
        jd_text: st.jdText ?? "",
        pending_requirements: pendingReqStr,
        schema_raw: oldSchemaSnapshot ?? null,
        sections: sectionsRef.current.map((s) => ({
          id: s.id,
          title: s.title,
          text: s.text,
          parentId: s.parentId ?? null,
          isGroup: !!s.isGroup,
        })),
      },
      state: {
        pending_requirements: pendingReqStr,
        schema_dirty: true,
        schema_raw: oldSchemaSnapshot ?? null,
        schema_provided_by_user: !!st.schemaProvidedByUser,
      },
    };

    console.log(
      "[architect] payload.pending_requirements =",
      payload.pending_requirements
    );

    const meta = {
      job_id: jid,
      sections: sectionsRef.current.length,
      pending_requirements_len: pendingReqStr.length,
      schemaProvidedByUser: !!st.schemaProvidedByUser,
      schemaRawPresent: !!oldSchemaSnapshot,
    };

    const { status, json } = await fetchJsonDebug<any>(
      "architect-adjust",
      "/api/architect",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      meta,
      fetchDbg
    );

    const data = json || {};
    if (!data?.ok) {
      throw new Error(
        data?.error || `Adjust structure failed (HTTP ${status})`
      );
    }

    const reqTxt = pickReqTextFromBackend(data);
    const promptTxt = pickPromptFromBackend(data);
    const schemaBase = pickSchemaBaseFromBackend(data) || oldSchemaSnapshot;
    const nextSchemaRaw = pickNextSchemaFromBackend(data);

    // Step C: validate next schema before committing; if invalid, do NOT overwrite currentSchema/currentSchemaDebug
    let nextSchemaAccepted: any = null;

    if (nextSchemaRaw) {
      const accepted = commitSchemaCandidateOrBlock({
        candidate: nextSchemaRaw,
        source: "adjust_structure",
        onAccepted: (validated) => {
          nextSchemaAccepted = validated;
        },
        onBlocked: () => {
          nextSchemaAccepted = null;
        },
      });

      if (!accepted) {
        // Keep debugSchemaNew visible, but do not commit currentSchema/currentSchemaDebug
        dispatch({
          type: "SET",
          patch: {
            debugSchemaOld: schemaBase,
            debugSchemaNew: nextSchemaRaw || null,
            debugReqText: reqTxt ?? st.debugReqText,
            debugPromptText: promptTxt ?? "",
            pendingRequirements:
              typeof data.pending_requirements !== "undefined"
                ? data.pending_requirements
                : st.pendingRequirements,
            schemaDirty:
              typeof data.schema_dirty !== "undefined"
                ? !!data.schema_dirty
                : false,
            notice:
              "Adjust returned a schema, but it was blocked by sanity validator. Your current schema was NOT changed. See Debug Panel.",
          },
        });
      }
    }

    // If schema accepted, commit it to state (this is the ONLY place we overwrite schema state)
    if (nextSchemaAccepted) {
      dispatch({
        type: "SET",
        patch: {
          debugSchemaOld: schemaBase,
          debugSchemaNew: nextSchemaAccepted,
          currentSchema: nextSchemaAccepted,
          currentSchemaDebug: nextSchemaAccepted,
          debugReqText: reqTxt ?? st.debugReqText,
          debugPromptText: promptTxt ?? "",
          pendingRequirements:
            typeof data.pending_requirements !== "undefined"
              ? data.pending_requirements
              : st.pendingRequirements,
          schemaDirty:
            typeof data.schema_dirty !== "undefined"
              ? !!data.schema_dirty
              : false,
        },
      });
    } else if (!nextSchemaRaw) {
      // No schema returned; still update other debug fields
      dispatch({
        type: "SET",
        patch: {
          debugSchemaOld: schemaBase,
          debugSchemaNew: null,
          debugReqText: reqTxt ?? st.debugReqText,
          debugPromptText: promptTxt ?? "",
          pendingRequirements:
            typeof data.pending_requirements !== "undefined"
              ? data.pending_requirements
              : st.pendingRequirements,
          schemaDirty:
            typeof data.schema_dirty !== "undefined"
              ? !!data.schema_dirty
              : false,
        },
      });
    }

    const sectionsFromResp = pickSectionsFromBackend(data);
    if (Array.isArray(sectionsFromResp) && sectionsFromResp.length) {
      const nextSections = mapBackendSectionsToSections(sectionsFromResp);
      constraintsBaselineRef.current = buildConstraintsBaseline(
        nextSections,
        "empty"
      );
      const { openById, openGroups } = buildOpenMaps(nextSections);

      dispatch({
        type: "SET",
        patch: {
          sections: nextSections,
          openById,
          openGroups,
          notice:
            "Structure updated. Please review the updated split under 'Sections', then click 'Confirm CV Sections' again.",
        },
      });
      return;
    }

    // Only rebuild from schema if schema was accepted (never rebuild from blocked schema)
    if (nextSchemaAccepted) {
      const rebuilt = materializeSectionsFromSchema(
        nextSchemaAccepted,
        sectionsRef.current
      );
      if (rebuilt?.length) {
        constraintsBaselineRef.current = buildConstraintsBaseline(
          rebuilt,
          "keepConstraints"
        );
        const { openById, openGroups } = buildOpenMaps(rebuilt);
        dispatch({
          type: "SET",
          patch: {
            sections: rebuilt,
            openById,
            openGroups,
            notice:
              "Structure updated (rebuilt from schema). Please review and confirm again.",
          },
        });
        return;
      }

      dispatch({
        type: "SET",
        patch: {
          notice:
            "Schema updated (see Debug Panel), but could not rebuild sections from schema. Ensure schema contains `groups`/`sections` arrays or return `sections` from /api/architect.",
        },
      });
      return;
    }

    if (nextSchemaRaw && !nextSchemaAccepted) {
      // Already blocked; message was set above. Just stop here.
      return;
    }

    dispatch({
      type: "SET",
      patch: {
        notice:
          "Adjust succeeded but returned neither schema nor sections. Check worker logs.",
      },
    });
  } catch (e: any) {
    dispatch({
      type: "SET",
      patch: { notice: e?.message || "Adjust structure failed." },
    });
  }
}
