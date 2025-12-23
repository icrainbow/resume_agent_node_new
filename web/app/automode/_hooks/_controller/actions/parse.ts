"use client";

import type { Dispatch, State } from "../types";
import type { ParseResp, Section } from "../../../_types/types";
import { nowIso } from "../../../_utils/utils";
import { fetchJsonDebug } from "../../../_utils/fetch";
import {
  buildBaselineSchemaFromSections,
  materializeSectionsFromSchema,
} from "../../../_utils/schema";
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
}) {
  const { st, dispatch, setNotice, fetchDbg, jobIdRef, constraintsBaselineRef } =
    args;

  if (!st.resumeFile) return setNotice("Please upload a CV first.");
  if (!st.schemaFile)
    return setNotice(
      "Schema is required. Please upload a CV Schema JSON before parsing."
    );
  if (st.parseBusy) return;

  dispatch({
    type: "SET",
    patch: { parseBusy: true, notice: "Parsing CV with schema…" },
  });

  try {
    const fd = new FormData();
    fd.append("resume", st.resumeFile);
    fd.append("schema", st.schemaFile);

    const meta = {
      fileName: st.resumeFile.name,
      size: st.resumeFile.size,
      type: st.resumeFile.type,
      mode: "schema",
      schema: {
        name: st.schemaFile.name,
        size: st.schemaFile.size,
        type: st.schemaFile.type,
      },
    };

    const { status, json } = await fetchJsonDebug<ParseResp>(
      "parse-resume",
      "/api/parse/resume",
      { method: "POST", body: fd },
      meta,
      fetchDbg
    );

    const data: ParseResp = (json || {}) as any;
    if (!data?.ok) {
      const err = data?.error || `Parse failed (HTTP ${status})`;
      const rawLen = (data?.raw_text || "").length;
      dispatch({
        type: "SET",
        patch: {
          notice: `${err}. raw_text_len=${rawLen}`,
          sections: [],
          jobId: "",
          cvSectionsConfirmed: false,
        },
      });
      return;
    }

    const parsed = mapParseRespToSections(data);
    constraintsBaselineRef.current = buildConstraintsBaseline(parsed, "empty");
    const { openById, openGroups } = buildOpenMaps(parsed);

    // create job_id once
    const jid = newJobId();
    jobIdRef.current = jid;

    // schema baseline for debug
    let baseSchema = st.currentSchema;
    if (!st.schemaProvidedByUser || !baseSchema)
      baseSchema = buildBaselineSchemaFromSections(parsed);

    const ok = commitSchemaCandidateOrBlock({
      st,
      dispatch,
      candidate: baseSchema,
      source: "parse_baseline",
      onAccepted: (validated) => {
        dispatch({
          type: "SET",
          patch: {
            sections: parsed,
            openById,
            openGroups,
            previewUrl: "",
            previewDirty: true,
            exportLinks: null,
            jobId: jid,
            cvSectionsConfirmed: false,
            currentSchema: validated,
            currentSchemaDebug: validated,
            debugSchemaOld: validated,
            debugSchemaNew: null,
            debugReqText: "",
            debugPromptText: "",
            notice: `CV parsed (schema). sections=${parsed.length}. job_id=${jid}. Please press "Confirm CV Sections" before Generate Preview / Replace All / Export.`,
            chatVisible: true,
          },
        });
      },
      onBlocked: () => {
        dispatch({
          type: "SET",
          patch: {
            sections: parsed,
            openById,
            openGroups,
            previewUrl: "",
            previewDirty: true,
            exportLinks: null,
            jobId: jid,
            cvSectionsConfirmed: false,
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
    dispatch({
      type: "SET",
      patch: {
        notice: e?.message || "Failed to parse CV.",
        sections: [],
        jobId: "",
        cvSectionsConfirmed: false,
      },
    });
    jobIdRef.current = "";
  } finally {
    dispatch({ type: "SET", patch: { parseBusy: false } });
  }
}
