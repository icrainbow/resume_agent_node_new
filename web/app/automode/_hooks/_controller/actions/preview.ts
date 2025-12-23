"use client";

import type { Dispatch, State } from "../types";
import type { PdfApiResp } from "../../../_types/types";
import { fetchJsonDebug } from "../../../_utils/fetch";
import { ensureJobId } from "../job";
import { requireCvSectionsConfirmed } from "../gates";

export async function generatePdfAction(args: {
  st: State;
  dispatch: Dispatch;
  fetchDbg: { debugOn: boolean; pushEntry: (e: any) => void };
  jobIdRef: React.MutableRefObject<string>;
  sectionsRef: React.MutableRefObject<any[]>;
}) {
  const { st, dispatch, fetchDbg, jobIdRef, sectionsRef } = args;

  if (!requireCvSectionsConfirmed(st, dispatch, sectionsRef.current.length)) return;

  if (st.previewBusy || st.autoOptimizing || st.parseBusy) {
    dispatch({
      type: "SET",
      patch: { notice: "Busy. Please wait for the current task to finish." },
    });
    return;
  }

  dispatch({
    type: "SET",
    patch: { previewBusy: true, notice: "Generating Preview…" },
  });

  try {
    const jid = ensureJobId({ st, dispatch, jobIdRef });

    const actionableSections = (sectionsRef.current || [])
      .filter((s: any) => !s.isGroup && (s.text || "").trim())
      .map((s: any) => ({ id: s.id, title: s.title, text: s.text }));

    if (!actionableSections.length) {
      throw new Error("No actionable sections found to generate preview.");
    }

    const payload = { job_id: jid, sections: actionableSections };
    const meta = { job_id: jid, sections: actionableSections.length };

    const { status, json } = await fetchJsonDebug<PdfApiResp>(
      "pdf-preview",
      "/api/pdf",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      meta,
      fetchDbg
    );

    const data: PdfApiResp = (json || {}) as any;
    if (!data?.ok) {
      throw new Error(
        (data?.error || `Failed to generate preview (HTTP ${status})`).toString()
      );
    }

    const url = (data.url || "").toString();
    if (!url) throw new Error("Preview URL is missing.");

    dispatch({
      type: "SET",
      patch: { previewUrl: url, previewDirty: false, notice: "Preview updated." },
    });
  } catch (e: any) {
    dispatch({
      type: "SET",
      patch: { notice: e?.message || "Failed to generate preview." },
    });
  } finally {
    dispatch({ type: "SET", patch: { previewBusy: false } });
  }
}

export async function refreshPreviewAction(args: {
  st: State;
  dispatch: Dispatch;
}) {
  const { st, dispatch } = args;
  if (!st.previewUrl) {
    dispatch({
      type: "SET",
      patch: { notice: "No preview yet. Click Generate Preview first." },
    });
    return;
  }
  dispatch({
    type: "SET",
    patch: { previewDirty: false, notice: "Preview refreshed." },
  });
}
