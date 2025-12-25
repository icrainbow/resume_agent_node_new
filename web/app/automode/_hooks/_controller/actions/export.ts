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
    // Phase 4: Client-side payload validation
    if (!jid || !jid.trim()) {
      throw new Error("Missing job_id. Cannot export without a job ID.");
    }

    if (!sectionsRef.current || sectionsRef.current.length === 0) {
      throw new Error("No sections available. Please parse your resume first.");
    }

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

    // Validate filtered sections
    if (!payload.sections.length) {
      throw new Error("No actionable sections to export. All sections are empty or are groups.");
    }

    // Validate each section has required fields
    for (const section of payload.sections) {
      if (!section.id || !section.title) {
        throw new Error(`Section missing id or title: ${JSON.stringify(section).substring(0, 100)}`);
      }
      if (!section.text || !section.text.trim()) {
        throw new Error(`Section "${section.title}" has no text content.`);
      }
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

    // Phase 4: Prefer artifacts array, fallback to legacy pdf_url/docx_url
    let exportLinks: { pdf?: string; docx?: string; artifacts?: any[] } = {};

    if (data.artifacts && data.artifacts.length > 0) {
      // Use Phase 4 artifacts
      const pdfArtifact = data.artifacts.find((a) => a.kind === "pdf");
      const docxArtifact = data.artifacts.find((a) => a.kind === "docx");

      exportLinks = {
        pdf: pdfArtifact?.url,
        docx: docxArtifact?.url,
        artifacts: data.artifacts,
      };

      if (!exportLinks.pdf || !exportLinks.docx) {
        throw new Error("Export succeeded but missing PDF or DOCX artifact.");
      }
    } else {
      // Fallback to legacy fields
      const pdf = data.pdf_url?.toString() || "";
      const docx = data.docx_url?.toString() || "";

      if (!pdf || !docx) {
        throw new Error("Export API returned missing pdf_url/docx_url.");
      }

      exportLinks = { pdf, docx };
    }

    dispatch({
      type: "SET",
      patch: {
        exportLinks,
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
