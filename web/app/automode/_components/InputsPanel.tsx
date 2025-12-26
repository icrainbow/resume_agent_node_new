// web/app/automode/_components/InputsPanel.tsx
"use client";

import { useMemo } from "react";

type Props = {
  // refs (owned by page)
  resumeInputRef: React.RefObject<HTMLInputElement>;
  schemaInputRef: React.RefObject<HTMLInputElement>;
  jdInputRef: React.RefObject<HTMLInputElement>;

  // files + setters (owned by page)
  resumeFile: File | null;
  setResumeFile: (f: File | null) => void;

  schemaFile: File | null;
  loadUserSchemaFile: (f: File | null) => Promise<void> | void;

  jdFile: File | null;
  setJdFile: (f: File | null) => void;

  // JD editable text
  jdText: string;
  setJdText: (v: string) => void;
  jdDirty: boolean;
  jdHint: string;

  // parse CV
  parseCv: () => Promise<void> | void;
  parseBusy: boolean;
  parseDisabled: boolean;

  // whole CV optimize
  optimizeWholeCV: () => Promise<void> | void;
  autoOptimizing: boolean;
  wholeCvDisabled: boolean;
  progress: {
    running: boolean;
    current: number;
    total: number;
    currentTitle?: string;
  };

  // global notes
  wholeCvNotes: string;
  setWholeCvNotes: (v: string) => void;
  DEFAULT_WHOLE_CV_NOTES: string;
  wholeCvNotesBaselineRef: React.MutableRefObject<string>;
  wholeCvNotesDirty: boolean;

  // ✅ schema adjustment requirements (NEW)
  pendingRequirements: any;
  setPendingRequirements: (v: any) => void;

  // reset
  resetAll: () => void;

  // constraints hint
  anyConstraintsDirty: boolean;

  // UI tokens
  ui: {
    BTN_BASE: string;
    BTN_SM: string;
    BTN_XS: string;
    BTN_PRIMARY: string;
    BTN_SECONDARY: string;
    BTN_OUTLINE: string;
  };
};

export default function InputsPanel(props: Props) {
  const {
    resumeInputRef,
    schemaInputRef,
    jdInputRef,

    resumeFile,
    setResumeFile,

    schemaFile,
    loadUserSchemaFile,

    jdFile,
    setJdFile,

    jdText,
    setJdText,
    jdDirty,
    jdHint,

    parseCv,
    parseBusy,
    parseDisabled,

    optimizeWholeCV,
    autoOptimizing,
    wholeCvDisabled,
    progress,

    wholeCvNotes,
    setWholeCvNotes,
    DEFAULT_WHOLE_CV_NOTES,
    wholeCvNotesBaselineRef,
    wholeCvNotesDirty,

    // NEW
    pendingRequirements,
    setPendingRequirements,

    resetAll,
    anyConstraintsDirty,

    ui,
  } = props;

  const cvBtnText = useMemo(
    () => (resumeFile ? "Change file" : "Choose file"),
    [resumeFile]
  );
  const schemaBtnText = useMemo(
    () => (schemaFile ? "Change file" : "Choose file"),
    [schemaFile]
  );
  const jdBtnText = useMemo(() => (jdFile ? "Change file" : "Choose file"), [jdFile]);

  const pendingReqStr = useMemo(() => {
    if (pendingRequirements == null) return "";
    if (typeof pendingRequirements === "string") return pendingRequirements;
    // if someone passes object accidentally, stringify for visibility (safe)
    try {
      return JSON.stringify(pendingRequirements, null, 2);
    } catch {
      return String(pendingRequirements);
    }
  }, [pendingRequirements]);

  return (
    <aside className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-800">Inputs</h3>

      <div className="mt-4 space-y-4 text-sm">
        {/* Upload CV */}
        <div>
          <div className="font-semibold">Upload CV</div>

          <input
            ref={resumeInputRef}
            id="resume-upload"
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
          />

          <div className="mt-2 flex min-w-0 items-center gap-3">
            <label
              htmlFor="resume-upload"
              className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_OUTLINE} cursor-pointer`}
            >
              {cvBtnText}
            </label>

            <span
              className="min-w-0 flex-1 truncate text-xs text-slate-600"
              title={resumeFile ? resumeFile.name : ""}
            >
              {resumeFile ? resumeFile.name : "No file selected"}
            </span>
          </div>
        </div>

        {/* Upload CV Schema (OPTIONAL) */}
        <div>
          <div className="font-semibold">Upload CV Schema (Optional)</div>

          <input
            ref={schemaInputRef}
            id="schema-upload"
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="upload-schema"
            data-action="upload-schema"
            onChange={async (e) => {
              const f = e.target.files?.[0] || null;
              await loadUserSchemaFile(f);
            }}
          />

          <div className="mt-2 flex min-w-0 items-center gap-3">
            <label
              htmlFor="schema-upload"
              data-testid="btn-upload-schema"
              data-action="upload-schema"
              className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_OUTLINE} cursor-pointer`}
            >
              {schemaBtnText}
            </label>

            <span
              className="min-w-0 flex-1 truncate text-xs text-slate-600"
              title={schemaFile ? schemaFile.name : ""}
            >
              {schemaFile ? schemaFile.name : "No schema (will parse as UNKNOWN section)"}
            </span>
          </div>

          <div className="mt-2 text-xs text-slate-500">
            Optional. Without schema, entire document becomes one UNKNOWN section.
          </div>
        </div>

        <button
          type="button"
          onClick={parseCv}
          disabled={parseDisabled}
          className={`${ui.BTN_BASE} h-10 w-full px-4 text-sm ${ui.BTN_PRIMARY}`}
          title={
            !resumeFile
              ? "Upload a CV first."
              : undefined
          }
        >
          {parseBusy ? "Parsing CV…" : "Parse CV"}
        </button>

        {/* ✅ NEW: Requirements for schema adjustment */}
        <div>
          <div className="flex items-center justify-between">
            <div className="font-semibold">Requirements for Schema Adjustment</div>
            <span className="text-[11px] text-slate-500">{pendingReqStr.length} chars</span>
          </div>

          <textarea
            className={[
              "mt-2 w-full resize-none rounded-xl border px-3 py-2 text-sm text-slate-700 outline-none",
              "bg-gradient-to-b from-white to-slate-50/40",
              "shadow-sm ring-1 ring-slate-200/60",
              "focus:ring-4 focus:ring-[#bfe7e3]/40",
              "border-slate-200 focus:border-slate-300",
            ].join(" ")}
            rows={6}
            placeholder={[
              "Describe how you want to change the CV structure.",
              "Examples:",
              "- Merge duplicated sections",
              "- Split 'Experience' into 'Professional Experience' + 'Projects'",
              "- Move 'Publications' under a group",
            ].join("\n")}
            value={pendingReqStr}
            onChange={(e) => setPendingRequirements(e.target.value)}
          />

          <div className="mt-2 text-xs text-slate-500">
            This text will be sent as <code className="rounded bg-slate-100 px-1">pending_requirements</code> when you trigger Schema Adjust (chat).
          </div>
        </div>

        {/* JD */}
        <div>
          <div className="font-semibold">Upload JD</div>

          <input
            ref={jdInputRef}
            id="jd-upload"
            type="file"
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={(e) => setJdFile(e.target.files?.[0] || null)}
          />

          <div className="mt-2 flex min-w-0 items-center gap-3">
            <label
              htmlFor="jd-upload"
              className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_OUTLINE} cursor-pointer`}
            >
              {jdBtnText}
            </label>

            <span
              className="min-w-0 flex-1 truncate text-xs text-slate-600"
              title={jdFile ? jdFile.name : ""}
            >
              {jdFile ? jdFile.name : "No file selected"}
            </span>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">JD Text (editable)</div>
              {jdDirty && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                  Edited
                </span>
              )}
            </div>

            <textarea
              className={[
                "mt-2 h-28 w-full resize-none rounded-xl border px-3 py-2 text-sm text-slate-700 outline-none",
                "focus:ring-4 focus:ring-[#bfe7e3]/40",
                jdDirty
                  ? "border-amber-300 bg-amber-50/50 ring-1 ring-amber-200 focus:border-amber-400"
                  : "border-slate-200 bg-white focus:border-slate-300",
              ].join(" ")}
              placeholder="JD will auto-load after upload. You can edit it here…"
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
            />

            <div className="mt-2 text-xs text-slate-500">{jdHint}</div>
          </div>

          <button
            type="button"
            onClick={optimizeWholeCV}
            disabled={wholeCvDisabled}
            className={`${ui.BTN_BASE} h-10 w-full px-4 text-sm ${ui.BTN_PRIMARY}`}
          >
            {autoOptimizing
              ? `Optimizing… ${progress.current}/${progress.total}`
              : "Optimize Whole CV"}
          </button>

          {/* Notes */}
          <div className="mt-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-700">
                Whole CV Optimization Notes
              </div>

              <div className="flex items-center gap-2">
                {wholeCvNotesDirty && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                    Edited
                  </span>
                )}

                <span className="text-[11px] text-slate-500">
                  {wholeCvNotes.length} chars
                </span>

                <button
                  type="button"
                  onClick={() => {
                    setWholeCvNotes(DEFAULT_WHOLE_CV_NOTES);
                    wholeCvNotesBaselineRef.current = DEFAULT_WHOLE_CV_NOTES;
                  }}
                  className={`${ui.BTN_BASE} ${ui.BTN_XS} ${ui.BTN_OUTLINE}`}
                  title="Reset to default notes"
                >
                  Reset
                </button>
              </div>
            </div>

            <textarea
              className={[
                "mt-2 w-full resize-none rounded-xl border px-3 py-2 text-sm text-slate-700 outline-none",
                "bg-gradient-to-b from-white to-slate-50/40",
                "shadow-sm ring-1 ring-slate-200/60",
                "focus:ring-4 focus:ring-[#bfe7e3]/40",
                wholeCvNotesDirty
                  ? "border-amber-300 ring-amber-200 focus:border-amber-400"
                  : "border-slate-200 focus:border-slate-300",
              ].join(" ")}
              rows={6}
              placeholder="Optional global instructions for whole-CV optimization…"
              value={wholeCvNotes}
              onChange={(e) => setWholeCvNotes(e.target.value)}
            />

            <div className="mt-2 text-[11px] text-slate-500">
              Tip: Use this to enforce tone (factual vs. punchy), formatting, and strictness on numbers/dates across all sections.
            </div>
          </div>

          {progress.running && (
            <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800 ring-1 ring-emerald-100">
              <div className="font-semibold">
                Progress: {progress.current}/{progress.total}
              </div>
              {progress.currentTitle && (
                <div className="mt-1 text-emerald-700">
                  Current: {progress.currentTitle}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={resetAll}
            disabled={autoOptimizing || parseBusy}
            className={`${ui.BTN_BASE} h-10 w-full px-4 text-sm ${ui.BTN_SECONDARY}`}
          >
            Reset (Clear All)
          </button>

          {anyConstraintsDirty && (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-100">
              Some constraints were edited. Optimization will use the edited constraints.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
