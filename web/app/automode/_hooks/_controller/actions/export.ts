"use client";

import type { ExportResp, Section } from "../../../_types/types";
import { fetchJsonDebug } from "../../../_utils/fetch";

import type { Dispatch, State } from "../types";
import { ensureJobId } from "../job";
import { requireCvSectionsConfirmed } from "../gates";

export async function generateCvDownloadsAction(args: {
  st: State;
  dispatch: Dispatch;
  fetchDbg: { debugOn: boolean; pushEntry: (e: any) => void };
  jobIdRef: React.MutableRefObject<string>;
  sectionsRef: React.MutableRefObject<Section[]>;
}) {
  const { st, dispatch, fetchDbg, jobIdRef, sectionsRef } = args;

  if (!requireCvSectionsConfirmed(st, dispatch, sectionsRef.current.length)) return;
  if (st.exportBusy) return;

  const jid = ensureJobId({ st, dispatch, jobIdRef });

  dispatch({
    type: "SET",
    patch: {
      exportBusy: true,
      exportLinks: null,
      notice: "Generating downloadable CV files (PDF + DOCX)…",
    },
  });

  try {
    const payload = {
      job_id: jid,
      base_name: st.resumeFile?.name || "Resume",
      sections: (sectionsRef.current || [])
        .filter((s) => !s.isGroup && (s.text || "").trim())
        .map((s) => ({
          id: s.id,
          title: s.title,
          text: s.text || "",
          optimized_text: (s.text || "").trim(),
          warnings: [],
        })),
      export_pdf: true,
    };

    if (!payload.sections.length) {
      throw new Error("No actionable sections to export.");
    }

    const { status, json } = await fetchJsonDebug<ExportResp>(
      "export",
      "/api/export",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      { sections: payload.sections.length, job_id: payload.job_id },
      fetchDbg
    );

    const data: ExportResp = (json || {}) as any;
    if (!data?.ok) {
      const details = (data as any)?.details
        ? `\n${JSON.stringify((data as any).details)}`
        : "";
      throw new Error((data?.error || `Export failed (HTTP ${status})`) + details);
    }

    const pdf = (data as any).pdf_url?.toString() || "";
    const docx = (data as any).docx_url?.toString() || "";
    if (!pdf || !docx) {
      throw new Error("Export API returned missing pdf_url/docx_url.");
    }

    dispatch({
      type: "SET",
      patch: {
        exportLinks: { pdf, docx },
        notice: `CV generated. Download links are ready. job_id=${jid}`,
      },
    });
  } catch (e: any) {
    dispatch({
      type: "SET",
      patch: { notice: e?.message || "Failed to generate downloadable CV." },
    });
  } finally {
    dispatch({ type: "SET", patch: { exportBusy: false } });
  }
}
