// web/app/automode/page.tsx
"use client";

console.log("🔥 PAGE MARKER: automode page.tsx loaded");

import { useEffect, useRef, useState } from "react";

import InputsPanel from "./_components/InputsPanel";
import SectionsPanel from "./_components/SectionsPanel";
import EmptyState from "./_components/EmptyState";
import PreviewPanel from "./_components/PreviewPanel";

/**
 * IMPORTANT (Linux/CI case-sensitive):
 * Ensure the import path matches your actual filename exactly:
 * - If file is components/ArchitectChat.tsx => keep as below.
 * - If file is components/architectchat.tsx => change to "@/components/architectchat"
 */
import ArchitectChat from "@/components/ArchitectChat";

import { useAutoModeController } from "./_hooks/_controller/useAutoModeController";

export default function Page() {
  const resumeInputRef = useRef<HTMLInputElement | null>(null);
  const schemaInputRef = useRef<HTMLInputElement | null>(null);
  const jdInputRef = useRef<HTMLInputElement | null>(null);
  const previewAnchorRef = useRef<HTMLDivElement | null>(null);

  // ✅ Debug panel should be hidden by default
  const [debugPanelVisible, setDebugPanelVisible] = useState(false);

  const DEFAULT_WHOLE_CV_NOTES =
    "Optimize the entire CV against the JD with a professional, factual tone.\n" +
    "- Keep company names, titles, dates, and metrics EXACT.\n" +
    "- Prefer concise bullets; remove fluff and repetition.\n" +
    "- Do not invent achievements; if unclear, keep neutral wording.\n" +
    "- Keep wording consistent across sections (tense, style, terminology).\n" +
    "- Avoid exaggerated adjectives; highlight impact with concrete evidence.\n";

  const ctrl = useAutoModeController({
    DEFAULT_WHOLE_CV_NOTES,
    resumeInputRef,
    schemaInputRef,
    jdInputRef,
  });

  // ✅ DEV diagnostics (truth source): log when state ACTUALLY changes (not same-tick reads)
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    console.log(
      "[DEV][STATE] resumeFile:",
      ctrl.resumeFile?.name,
      ctrl.resumeFile?.size
    );
  }, [ctrl.resumeFile]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    console.log(
      "[DEV][STATE] schemaFile/provided:",
      ctrl.schemaFile?.name,
      ctrl.schemaFile?.size,
      "schemaProvidedByUser:",
      (ctrl as any).schemaProvidedByUser
    );
  }, [ctrl.schemaFile]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    console.log(
      "[DEV][STATE] jdTextLen/jdFile:",
      (ctrl.jdText || "").length,
      ctrl.jdFile?.name
    );
  }, [ctrl.jdText, ctrl.jdFile]);

  /**
   * =========================
   * ✅ FIX: Preview click wrapper
   * =========================
   */
  const handleGeneratePreview = async () => {
    await ctrl.generatePdf();

    setTimeout(() => {
      previewAnchorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  };

  const inputs = {
    resumeInputRef: ctrl.resumeInputRef,
    schemaInputRef: ctrl.schemaInputRef,
    jdInputRef: ctrl.jdInputRef,

    resumeFile: ctrl.resumeFile,
    setResumeFile: ctrl.setResumeFile,

    schemaFile: ctrl.schemaFile,
    loadUserSchemaFile: ctrl.loadUserSchemaFile,

    jdFile: ctrl.jdFile,
    setJdFile: ctrl.setJdFile,

    jdText: ctrl.jdText,
    setJdText: ctrl.setJdText,
    jdDirty: ctrl.jdDirty,
    jdHint: ctrl.jdHint,

    pendingRequirements: ctrl.pendingRequirements,
    setPendingRequirements: ctrl.setPendingRequirements,

    parseCv: ctrl.parseCv,
    parseBusy: ctrl.parseBusy,
    parseDisabled: ctrl.parseDisabled,

    optimizeWholeCV: ctrl.optimizeWholeCV,
    autoOptimizing: ctrl.autoOptimizing,
    wholeCvDisabled: ctrl.wholeCvDisabled,

    progress: ctrl.progress,

    wholeCvNotes: ctrl.wholeCvNotes,
    setWholeCvNotes: ctrl.setWholeCvNotes,
    DEFAULT_WHOLE_CV_NOTES: ctrl.DEFAULT_WHOLE_CV_NOTES ?? DEFAULT_WHOLE_CV_NOTES,
    wholeCvNotesBaselineRef: ctrl.wholeCvNotesBaselineRef,
    wholeCvNotesDirty: ctrl.wholeCvNotesDirty,

    resetAll: ctrl.resetAll,
    anyConstraintsDirty: ctrl.anyConstraintsDirty,

    ui: ctrl.inputsPanelUI,
  };

  const sectionsCtx = {
    sections: ctrl.sections,
    roots: ctrl.roots,
    childrenByParent: ctrl.childrenByParent,

    openById: ctrl.openById,
    setOpenById: ctrl.setOpenById,

    openGroups: ctrl.openGroups,
    setOpenGroups: ctrl.setOpenGroups,

    cvSectionsConfirmed: ctrl.cvSectionsConfirmed,
    setCvSectionsConfirmed: ctrl.setCvSectionsConfirmed,

    previewBusy: ctrl.previewBusy,
    replaceAllDisabled: ctrl.replaceAllDisabled,
    gateDeemphasis: ctrl.gateDeemphasis,

    constraintsDirtyById: ctrl.constraintsDirtyById,

    progress: ctrl.progress,

    jdText: ctrl.jdText,

    setNotice: ctrl.setNotice,

    onAdjustStructure: async () => {
      await ctrl.handleChatAdjust();
      ctrl.setChatVisible(true);
    },

    onReplaceAll: ctrl.replaceAll,
    onGeneratePreview: handleGeneratePreview,

    onOptimizeOne: (s: any) => ctrl.optimizeOne(s.id),

    onCloseSection: ctrl.onCloseSection,
    onSectionTextChange: ctrl.onSectionTextChange,
    onConstraintChange: ctrl.onConstraintChange,
    onMergeReplaceOne: ctrl.onMergeReplaceOne,

    autoOptimizing: ctrl.autoOptimizing,
    parseBusy: ctrl.parseBusy,

    TEXT_BOX_H: (ctrl.sectionsPanelUI as any)?.TEXT_BOX_H,

    ui: ctrl.sectionsPanelUI,
  };

  const previewCtx = {
    previewUrl: ctrl.previewUrl,
    previewDirty: ctrl.previewDirty,
    previewBusy: ctrl.previewBusy,
    exportBusy: ctrl.exportBusy,

    autoOptimizing: ctrl.autoOptimizing,
    parseBusy: ctrl.parseBusy,

    cvSectionsConfirmed: ctrl.cvSectionsConfirmed,
    gateDeemphasis: ctrl.gateDeemphasis,

    exportLinks: ctrl.exportLinks,

    onGenerateCv: ctrl.generateCvDownloads,

    onRefreshPreview: ctrl.refreshPreview,
    onClosePreview: () => ctrl.setPreviewUrl(""),
    onGeneratePreview: handleGeneratePreview,

    ui: {
      BTN_BASE: ctrl.BTN_BASE,
      BTN_SM: ctrl.BTN_SM,
      BTN_PRIMARY: ctrl.BTN_PRIMARY,
      BTN_SECONDARY: ctrl.BTN_SECONDARY,
      BTN_OUTLINE: ctrl.BTN_OUTLINE,
    },
  };

  const footer = {
    notice: ctrl.notice,
    onGeneratePreview: handleGeneratePreview,
    disabled: ctrl.previewBusy || ctrl.autoOptimizing || ctrl.parseBusy,
    className: `${ctrl.BTN_BASE} h-11 w-full px-4 text-sm ${ctrl.BTN_PRIMARY} ${ctrl.gateDeemphasis}`,
    title: !ctrl.cvSectionsConfirmed
      ? 'Please press "Confirm CV Sections" to confirm CV parsing result first.'
      : undefined,
    label: ctrl.previewBusy ? "Generating Preview…" : "Generate Preview",
  };

  const chat = {
    key: ctrl.jobId || "no-job",
    currentSchema: ctrl.chatSchema,
    visible: ctrl.chatVisible,
    cvSectionsConfirmed: ctrl.cvSectionsConfirmed,
    schemaDirty: ctrl.schemaDirty,
    pendingReq: ctrl.pendingRequirements,
    onConfirm: () => {
      if (!ctrl.sectionsRef.current.length) {
        ctrl.setNotice("No CV sections yet. Please parse the CV first.");
        return;
      }
      ctrl.setCvSectionsConfirmed(true);
      ctrl.setSchemaDirty(false);
      ctrl.setNotice("CV sections confirmed via Architect Chat.");
    },
    onAdjust: ctrl.handleChatAdjust,
    onChatUpdate: ctrl.handleChatUpdate,
  };

  return (
    <>
      <main className="min-h-screen bg-[#eef6f5] px-6 py-10 text-slate-900 overflow-x-hidden">
        <div className="mx-auto max-w-6xl rounded-3xl bg-white shadow-xl ring-1 ring-slate-200">
          {/* Header */}
          <div className="px-10 pt-10 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-lg font-semibold">Auto Mode</div>

              <div className="flex flex-wrap items-center gap-2">
                {/* ✅ Load Testing Parameters stays OUTSIDE (always visible) */}
                <button
                  type="button"
                  onClick={ctrl.devBootstrap}
                  disabled={ctrl.parseBusy || ctrl.autoOptimizing || ctrl.previewBusy}
                  className={`${ctrl.BTN_BASE} ${ctrl.BTN_SM} ${ctrl.BTN_OUTLINE}`}
                  title="Load testing parameters (dev helper)"
                >
                  Load Testing Parameters
                </button>

                {/* ✅ Debug panel toggle (default hidden) */}
                <button
                  type="button"
                  onClick={() => setDebugPanelVisible((v) => !v)}
                  className={`${ctrl.BTN_BASE} ${ctrl.BTN_SM} ${ctrl.BTN_OUTLINE}`}
                  title={debugPanelVisible ? "Hide Debug Panel" : "Show Debug Panel"}
                >
                  {debugPanelVisible ? "Hide Debug Panel" : "Show Debug Panel"}
                </button>
              </div>
            </div>

            {/* ✅ Debug panel content (only visible when toggled) */}
            {debugPanelVisible ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-semibold text-slate-700">Debug Panel</div>
              </div>
            ) : null}
          </div>

          <div className="mt-8 border-t border-slate-200" />

          <div className="grid grid-cols-1 gap-6 px-10 py-8 lg:grid-cols-[360px_1fr]">
            {/* Left: Inputs */}
            <InputsPanel {...inputs} />

            {/* Right: Main content */}
            <div className="min-w-0 space-y-6">
              {!sectionsCtx.sections.length ? (
                <EmptyState resumeFile={inputs.resumeFile} />
              ) : (
                <>
                  <SectionsPanel {...sectionsCtx} />
                  <div ref={previewAnchorRef} />
                  <PreviewPanel {...previewCtx} />
                </>
              )}

              {/* Footer notice + bottom preview button */}
              <div className="border border-slate-200 rounded-2xl px-5 py-5 bg-white shadow-sm">
                <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                  {footer.notice}
                </div>

                <button
                  type="button"
                  onClick={footer.onGeneratePreview}
                  disabled={footer.disabled}
                  className={footer.className}
                  title={footer.title}
                >
                  {footer.label}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Floating ArchitectChat */}
      <ArchitectChat
        key={chat.key}
        currentSchema={chat.currentSchema}
        visible={chat.visible}
        cvSectionsConfirmed={chat.cvSectionsConfirmed}
        schemaDirty={chat.schemaDirty}
        pendingReq={chat.pendingReq}
        onConfirm={chat.onConfirm}
        onAdjust={chat.onAdjust}
        onChatUpdate={chat.onChatUpdate}
      />
    </>
  );
}
