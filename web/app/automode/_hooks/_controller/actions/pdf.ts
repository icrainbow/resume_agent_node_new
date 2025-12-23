"use client";

import type { PdfApiResp, Section } from "../../../_types/types";
import { fetchJsonDebug } from "../../../_utils/fetch";

import type { Dispatch, State } from "../types";
import type { ensureJobId as EnsureJobIdFn } from "../job";
import { requireCvSectionsConfirmed } from "../gates";

export async function generatePdfAction(args: {
  st: State;
  dispatch: Dispatch;
  setNotice: (notice: string) => void;
  fetchDbg: { debugOn: boolean; pushEntry: (e: any) => void };
  jobIdRef: React.MutableRefObject<string>;
  sectionsRef: React.MutableRefObject<Section[]>;
  ensureJobId: typeof EnsureJobIdFn;
}) {
  const { st, dispatch, setNotice, fetchDbg, jobIdRef, sectionsRef, ensureJobId } =
    args;

  // Mirrors controller gate: caller could gate, but keep it here so controller stays thin
  if (!requireCvSectionsConfirmed(st, dispatch, sectionsRef.current.length)) return;

  // Avoid concurrent operations
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

    // Only send actionable sections (non-group + non-empty text)
    const actionableSections = (sectionsRef.current || [])
      .filter((s) => !s.isGroup && (s.text || "").trim())
      .map((s) => ({
        id: s.id,
        title: s.title,
        text: s.text,
      }));

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
      patch: {
        previewUrl: url,
        previewDirty: false,
        notice: "Preview updated.",
      },
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
  setNotice: (notice: string) => void;
}) {
  const { st, dispatch, setNotice } = args;

  if (!st.previewUrl) {
    setNotice("No preview yet. Click Generate Preview first.");
    return;
  }

  dispatch({
    type: "SET",
    patch: { previewDirty: false, notice: "Preview refreshed." },
  });
}
