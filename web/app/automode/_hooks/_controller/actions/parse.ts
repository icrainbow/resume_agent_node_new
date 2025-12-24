"use client";

import type { Dispatch, State } from "../types";
import type { ParseResp } from "../../../_types/types";
import { nowIso } from "../../../_utils/utils";
import { fetchJsonDebug } from "../../../_utils/fetch";
import { buildBaselineSchemaFromSections } from "../../../_utils/schema";
import {
  buildConstraintsBaseline,
  buildOpenMaps,
  mapParseRespToSections,
  newJobId,
} from "../controller_helpers";
import { commitSchemaCandidateOrBlock } from "../debug";

export async function parseCvAction(args: {
  st: State;
  dispatch: Dispatch;
  setNotice: (s: string) => void;
  fetchDbg: { debugOn: boolean; pushEntry: (e: any) => void };
  jobIdRef: React.MutableRefObject<string>;
  constraintsBaselineRef: React.MutableRefObject<Record<string, string>>;

  // NEW: prevents stale parse responses from overwriting UI state
  parseTokenRef: React.MutableRefObject<string>;
}) {
  const {
    st,
    dispatch,
    setNotice,
    fetchDbg,
    jobIdRef,
    constraintsBaselineRef,
    parseTokenRef,
  } = args;

  if (!st.resumeFile) return setNotice("Please upload a CV first.");
  if (st.parseBusy) return;

  // Generate a token for THIS parse request.
  // Any later file selection will rotate this token (see cv_reset effect),
  // making this response stale and safely ignored.
  const token = nowIso();
  parseTokenRef.current = token;

  const hasSchema = !!st.schemaFile;
  const noticeMsg = hasSchema
    ? "Parsing CV with schema…"
    : "Parsing CV (no schema - will create UNKNOWN section)…";

  dispatch({
    type: "SET",
    patch: {
      parseBusy: true,
      notice: noticeMsg,

      // Clear UI immediately to avoid showing stale sections/errors while parsing.
      sections: [],
      openById: {},
      openGroups: {},
      cvSectionsConfirmed: false,
      previewUrl: "",
      previewDirty: false,
      exportLinks: null,
      jobId: "",
    },
  });

  try {
    const fd = new FormData();
    fd.append("resume", st.resumeFile);
    if (st.schemaFile) fd.append("schema", st.schemaFile);

    const meta: any = {
      fileName: st.resumeFile.name,
      size: st.resumeFile.size,
      type: st.resumeFile.type,
      mode: hasSchema ? "schema" : "noschema",
    };
    if (hasSchema && st.schemaFile) {
      meta.schema = {
        name: st.schemaFile.name,
        size: st.schemaFile.size,
        type: st.schemaFile.type,
      };
    }

    const { status, json } = await fetchJsonDebug<ParseResp>(
      "parse-resume",
      "/api/parse/resume",
      { method: "POST", body: fd },
      meta,
      fetchDbg
    );

    // If user changed files while request was in-flight, ignore late response.
    if (parseTokenRef.current !== token) {
      // eslint-disable-next-line no-console
      console.warn("[parseCvAction] stale response ignored", {
        token,
        active: parseTokenRef.current,
        status,
      });
      return;
    }

    const data: ParseResp = (json || {}) as any;
    if (!data?.ok) {
      const err = data?.error || `Parse failed (HTTP ${status})`;
      const rawLen = (data?.raw_text || "").length;

      dispatch({
        type: "SET",
        patch: {
          notice: `${err}. raw_text_len=${rawLen}`,
          jobId: "",
          cvSectionsConfirmed: false,
          chatVisible: false,
        },
      });
      jobIdRef.current = "";
      return;
    }

    const parsed = mapParseRespToSections(data);

    constraintsBaselineRef.current = buildConstraintsBaseline(parsed, "empty");
    const { openById, openGroups } = buildOpenMaps(parsed);

    const jid = newJobId();
    jobIdRef.current = jid;

    let baseSchema = st.currentSchema;
    if (!st.schemaProvidedByUser || !baseSchema) {
      baseSchema = buildBaselineSchemaFromSections(parsed);
    }

    const ok = commitSchemaCandidateOrBlock({
      st,
      dispatch,
      candidate: baseSchema,
      source: "parse_baseline",
      onAccepted: (validated) => {
        // Guard again (paranoia): do not write if stale.
        if (parseTokenRef.current !== token) return;

        dispatch({
          type: "SET_SECTIONS",
          sections: parsed,
          openById,
          openGroups,
          confirmed: false,
        });

        dispatch({
          type: "SET",
          patch: {
            previewUrl: "",
            previewDirty: true,
            exportLinks: null,
            jobId: jid,
            currentSchema: validated,
            currentSchemaDebug: validated,
            debugSchemaOld: validated,
            debugSchemaNew: null,
            debugReqText: "",
            debugPromptText: "",
            notice: `CV parsed. sections=${parsed.length}. job_id=${jid}. Please press "Confirm CV Sections" before Generate Preview / Replace All / Export.`,
            chatVisible: true,
          },
        });
      },
      onBlocked: () => {
        if (parseTokenRef.current !== token) return;

        dispatch({
          type: "SET_SECTIONS",
          sections: parsed,
          openById,
          openGroups,
          confirmed: false,
        });

        dispatch({
          type: "SET",
          patch: {
            previewUrl: "",
            previewDirty: true,
            exportLinks: null,
            jobId: jid,
            currentSchema: null,
            currentSchemaDebug: null,
            debugSchemaOld: baseSchema,
            debugSchemaNew: null,
            debugReqText: "",
            debugPromptText: "",
            notice:
              "CV parsed, but baseline schema was blocked by sanity validator. Please inspect Debug Panel.",
            chatVisible: true,
          },
        });
      },
    });

    if (!ok) return;
  } catch (e: any) {
    // Only show error if this request is still current.
    if (parseTokenRef.current !== token) return;

    dispatch({
      type: "SET",
      patch: {
        notice: e?.message || "Failed to parse CV.",
        jobId: "",
        cvSectionsConfirmed: false,
        chatVisible: false,
      },
    });
    jobIdRef.current = "";
  } finally {
    // Critical: do NOT blindly set parseBusy=false if a newer parse has started.
    if (parseTokenRef.current === token) {
      dispatch({ type: "SET", patch: { parseBusy: false } });
    }
  }
}
