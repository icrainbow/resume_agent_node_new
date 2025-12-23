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

  /**
   * =========================
   * ✅ Dock Chat UI state (fixed bottom, never covers content)
   * =========================
   * Requirements:
   * - Chat appears only after Parse CV (or Adjust Structure triggers chat)
   * - Default: collapsed (72–96px)
   * - Peek animation: 72 -> 160 -> 72
   * - Expand button: user expands when needed
   * - Main content padding-bottom always reserves Dock height (never cover sections)
   */
  const DOCK_H_COLLAPSED = 88; // 72–96px range
  const DOCK_H_PEEK = 160;
  const DOCK_H_EXPANDED = 420; // expanded panel height (tweak as needed)
  const PEEK_MS = 600;

  const [dockHeight, setDockHeight] = useState<number>(0);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(true);

  const peekTimerRef = useRef<number | null>(null);

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
   * ✅ Dock helpers
   * =========================
   */
  const clearPeekTimer = () => {
    if (peekTimerRef.current) {
      window.clearTimeout(peekTimerRef.current);
      peekTimerRef.current = null;
    }
  };

  const ensureDockVisibleCollapsed = () => {
    setDockCollapsed(true);
    setDockHeight(DOCK_H_COLLAPSED);
  };
// ✅ cleanup: avoid dangling peek timer on unmount / HMR
useEffect(() => {
  return () => {
    clearPeekTimer();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);


  const runPeek = () => {
    clearPeekTimer();
    // expand to peek height, then back to collapsed
    setDockCollapsed(true);
    setDockHeight(DOCK_H_PEEK);
    peekTimerRef.current = window.setTimeout(() => {
      setDockHeight(DOCK_H_COLLAPSED);
      peekTimerRef.current = null;
    }, PEEK_MS);
  };

  const openDockExpanded = () => {
    clearPeekTimer();
    setDockCollapsed(false);
    setDockHeight(DOCK_H_EXPANDED);
  };

  const collapseDock = () => {
    clearPeekTimer();
    setDockCollapsed(true);
    setDockHeight(DOCK_H_COLLAPSED);
  };

  // When ctrl.chatVisible flips true, ensure dock is present & do a peek once.
  const didFirstChatShowRef = useRef(false);
  useEffect(() => {
    if (!ctrl.chatVisible) return;

    // ensure dock exists
    if (dockHeight === 0) setDockHeight(DOCK_H_COLLAPSED);

    // first time auto-peek (Parse CV or first adjust)
    if (!didFirstChatShowRef.current) {
      didFirstChatShowRef.current = true;
      runPeek();
    } else {
      // subsequent shows: keep collapsed (no forced peek)
      ensureDockVisibleCollapsed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl.chatVisible]);

  
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

  /**
   * =========================
   * ✅ Parse CV wrapper:
   * - After parse completes, show Dock Chat (collapsed)
   * - Trigger one-time peek so user sees summary
   * =========================
   */

  const handleParseCvWithDock = async () => {
    await ctrl.parseCv();
    // ✅ only show dock if parse actually produced sections
    const hasSections = !!ctrl.sectionsRef.current?.length;
    if (hasSections) {
      ctrl.setChatVisible(true);
      ensureDockVisibleCollapsed();
      runPeek();
    }
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

    // ✅ override parseCv to inject dock behavior
    parseCv: handleParseCvWithDock,
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
      ensureDockVisibleCollapsed();
      runPeek();
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

  /**
   * =========================
   * ✅ Agent status label for dock
   * =========================
   */
  const agentStatus =
    ctrl.parseBusy || ctrl.autoOptimizing || ctrl.previewBusy
      ? "Parsing"
      : ctrl.schemaDirty
      ? "Needs confirmation"
      : "Ready";

  /**
   * =========================
   * ✅ Reserve bottom space so dock never covers content
   * =========================
   * - dockHeight is 0 before chat appears
   * - after Parse CV, dockHeight animates; content padding-bottom follows
   */
  const mainPaddingBottom = ctrl.chatVisible ? dockHeight : 0;

  return (
    <>
      <main
        className="min-h-screen bg-[#eef6f5] px-6 py-10 text-slate-900 overflow-x-hidden"
        style={{
          paddingBottom: mainPaddingBottom,
          transition: "padding-bottom 180ms ease",
        }}
      >
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
            <div className="min-w-0 flex h-[calc(100vh-220px)] flex-col">

              <div className="flex-1 overflow-y-auto space-y-6 pr-1">
                {!sectionsCtx.sections.length ? (
                  <EmptyState resumeFile={inputs.resumeFile} />
                ) : (
                  <>
                    <SectionsPanel {...sectionsCtx} />
                    <div ref={previewAnchorRef} />
                    <PreviewPanel {...previewCtx} />
                  </>
                )}
              </div>

              {/* Footer notice + bottom actions */}
              <div className="border border-slate-200 rounded-2xl px-5 py-5 bg-white shadow-sm">
                <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                  {footer.notice}
                </div>

                <div className="flex flex-col gap-3">
                  {/* ✅ Always-visible confirm at bottom */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!ctrl.sections.length) {
                        ctrl.setNotice("No CV sections yet. Please parse the CV first.");
                        return;
                      }
                      ctrl.setCvSectionsConfirmed(true);
                      ctrl.setNotice(
                        "CV sections confirmed. You can now Generate Preview / Replace All / Export."
                      );
                    }}
                    disabled={ctrl.autoOptimizing || ctrl.parseBusy || !ctrl.sections.length}
                    className={`${ctrl.BTN_BASE} h-11 w-full px-4 text-sm ${
                      ctrl.cvSectionsConfirmed
                        ? "bg-emerald-700 text-white hover:brightness-105 ring-1 ring-emerald-700/15"
                        : "bg-emerald-600 text-white hover:brightness-105 ring-1 ring-emerald-600/15"
                    }`}
                    title={
                      !ctrl.sections.length
                        ? 'Please click "Parse CV" first.'
                        : undefined
                    }
                  >
                    {ctrl.cvSectionsConfirmed ? "CV Sections Confirmed" : "Confirm Sections"}
                  </button>

                  {/* existing bottom preview button */}
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
        </div>
      </main>

      {/* =========================
          ✅ Dock ArchitectChat (NOT floating)
          - Only appears after Parse CV / Adjust Structure (ctrl.chatVisible)
          - Collapsed by default, can Expand
          - Peek is implemented by temporarily increasing dockHeight
         ========================= */}
      {ctrl.chatVisible ? (
        <div
          className="fixed bottom-0 left-0 right-0 z-50"
          style={{
            height: dockHeight,
            transition: "height 220ms ease",
          }}
        >
          {/* Align with main container width and page padding */}
          <div className="mx-auto max-w-6xl px-6 pb-6">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-xl ring-1 ring-slate-100 overflow-hidden">
              {/* Dock chrome (light teal/blue-green harmony) */}
              <div
                className="flex items-center justify-between gap-3 px-4 py-3 bg-[#e8f4f2] cursor-pointer select-none"
                role="button"
                tabIndex={0}
                title={dockCollapsed ? "Click to expand chat" : "Click to minimize chat"}
                onClick={() => {
                  if (dockCollapsed) openDockExpanded();
                  else collapseDock();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (dockCollapsed) openDockExpanded();
                    else collapseDock();
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#0f766e] text-white text-sm font-semibold">
                    A
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800">Architect Chat</div>
                    <div className="text-xs text-slate-600">
                      Status: <span className="font-medium">{agentStatus}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {dockCollapsed ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDockExpanded();
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                      title="Expand chat"
                    >
                      Expand <span aria-hidden>↑</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        collapseDock();
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                      title="Minimize chat"
                    >
                      Minimize <span aria-hidden>↓</span>
                    </button>
                  )}
                </div>
              </div>
              {/* ArchitectChat body: must support dock presentation */}
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
                // ✅ new props (you will add in ArchitectChat.tsx)
                presentation="dock"
                dockHeight={dockHeight}
                collapsed={dockCollapsed}
                onToggleCollapse={() => {
                  if (dockCollapsed) openDockExpanded();
                  else collapseDock();
                }}
                onRequestExpand={openDockExpanded}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
