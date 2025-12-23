"use client";

import type { Section } from "../_types/types";

type Props = {
  // data
  sections: Section[];
  roots: Section[];
  childrenByParent: Map<string, Section[]>;

  // UI state
  openById: Record<string, boolean>;
  setOpenById: (
    updater:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void;

  openGroups: Record<string, boolean>;
  setOpenGroups: (
    updater:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void;

  // confirmation gate
  cvSectionsConfirmed: boolean;
  setCvSectionsConfirmed: (v: boolean) => void;

  // flags
  autoOptimizing: boolean;
  parseBusy: boolean;
  previewBusy: boolean;
  replaceAllDisabled: boolean;

  // misc derived
  gateDeemphasis: string;
  TEXT_BOX_H: string;
  jdText: string;
  constraintsDirtyById: Record<string, boolean>;

  // progress badge
  progress: {
    running: boolean;
    current: number;
    total: number;
    currentTitle?: string;
  };

  // callbacks (page owns business logic)
  setNotice: (v: string) => void;

  onAdjustStructure: () => Promise<void> | void;
  onReplaceAll: () => void;
  onGeneratePreview: () => Promise<void> | void;

  onOptimizeOne: (s: Section) => Promise<void> | void;
  onCloseSection: (id: string) => void;

  onSectionTextChange: (id: string, v: string) => void;
  onConstraintChange: (id: string, v: string) => void;
  onMergeReplaceOne: (id: string) => void;

  // style tokens from page
  ui: {
    BTN_BASE: string;
    BTN_SM: string;
    BTN_XS: string;
    BTN_PRIMARY: string;
    BTN_SECONDARY: string;
    BTN_OUTLINE: string;
  };
};

export default function SectionsPanel(props: Props) {
  const {
    sections,
    roots,
    childrenByParent,

    openById,
    setOpenById,
    openGroups,
    setOpenGroups,

    cvSectionsConfirmed,
    setCvSectionsConfirmed,

    autoOptimizing,
    parseBusy,
    previewBusy,
    replaceAllDisabled,

    gateDeemphasis,
    TEXT_BOX_H,
    jdText,
    constraintsDirtyById,

    progress,

    setNotice,

    onAdjustStructure,
    onReplaceAll,
    onGeneratePreview,

    onOptimizeOne,
    onCloseSection,

    onSectionTextChange,
    onConstraintChange,
    onMergeReplaceOne,

    ui,
  } = props;

  const toggleSection = (id: string) =>
    setOpenById((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }));

  const closeSection = (id: string) =>
    setOpenById((prev) => ({ ...prev, [id]: false }));

  const toggleGroup = (groupId: string) =>
    setOpenGroups((prev) => ({ ...prev, [groupId]: !(prev[groupId] ?? true) }));

  const renderSectionRow = (s: Section) => {
    const isActionable = !s.isGroup;

    return (
      <div key={s.id} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left cell: Original */}
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <h4 className="min-w-0 flex-1 truncate font-semibold" title={s.title}>
              {s.title}
            </h4>

            {autoOptimizing && progress.running && (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                Whole CV {progress.current}/{progress.total}
              </span>
            )}
          </div>

          <textarea
            className={[
              "mt-2",
              TEXT_BOX_H,
              "min-w-0 w-full resize-none overflow-y-auto overflow-x-hidden",
              "whitespace-pre-wrap break-words",
              "rounded-lg bg-slate-50/60 p-3 text-sm text-slate-700",
              "ring-1 ring-slate-200",
              "outline-none focus:ring-4 focus:ring-[#bfe7e3]/40",
            ].join(" ")}
            value={s.text}
            placeholder="—"
            onChange={(e) => onSectionTextChange(s.id, e.target.value)}
            disabled={!isActionable}
          />

          <div className="mt-3 flex items-stretch gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">
                  Constraints (optional)
                </span>
                {constraintsDirtyById[s.id] && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                    Edited
                  </span>
                )}
              </div>

              <textarea
                className={[
                  "min-w-0 w-full resize-none rounded-lg border p-2 text-sm outline-none",
                  "focus:ring-4 focus:ring-[#bfe7e3]/40",
                  constraintsDirtyById[s.id]
                    ? "border-amber-300 bg-amber-50/50 ring-1 ring-amber-200 focus:border-amber-400"
                    : "border-slate-200 focus:border-slate-300",
                ].join(" ")}
                placeholder={
                  isActionable
                    ? "E.g. keep numbers exact; avoid exaggeration; keep it concise…"
                    : "Group section (no constraints)."
                }
                value={s.constraints}
                onChange={(e) => onConstraintChange(s.id, e.target.value)}
                rows={2}
                disabled={!isActionable}
              />
            </div>

            <button
              type="button"
              onClick={() => onOptimizeOne(s)}
              disabled={!!s.optimizing || autoOptimizing || !isActionable}
              className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_PRIMARY}`}
              title={
                !isActionable
                  ? "Group section has no text. Optimize child sections."
                  : !jdText.trim()
                  ? "Provide JD text first."
                  : undefined
              }
            >
              {s.optimizing ? "Optimizing…" : "Optimize"}
            </button>
          </div>

          {s.error && (
            <div className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700 ring-1 ring-red-100">
              {s.error}
            </div>
          )}
        </div>

        {/* Right cell: Optimized */}
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <h4 className="min-w-0 flex-1 truncate font-semibold" title={s.title}>
              {s.title}
            </h4>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  onCloseSection(s.id);
                  closeSection(s.id);
                }}
                className={`${ui.BTN_BASE} ${ui.BTN_XS} ${ui.BTN_SECONDARY}`}
                title="Collapse this section"
              >
                Collapse
              </button>

              <button
                type="button"
                onClick={() => onMergeReplaceOne(s.id)}
                disabled={!s.optimizedText || autoOptimizing || !isActionable}
                className={`${ui.BTN_BASE} ${ui.BTN_XS} ${ui.BTN_PRIMARY}`}
                title={!isActionable ? "Group section has no merge action." : undefined}
              >
                Merge & Replace
              </button>
            </div>
          </div>

          <pre
            className={[
              "mt-2",
              TEXT_BOX_H,
              "min-w-0 overflow-y-auto overflow-x-hidden",
              "whitespace-pre-wrap break-words",
              "rounded-lg bg-slate-50/60 p-3 text-sm text-slate-700",
              "ring-1 ring-slate-200",
            ].join(" ")}
          >
            {s.optimizedText || "—"}
          </pre>
        </div>
      </div>
    );
  };

  const renderOutlineRow = (s: Section) => {
    const isOpen = !!openById[s.id];
    const hasOptimized = !!(s.optimizedText || "").trim();
    const hasConstraintsEdited = !!constraintsDirtyById[s.id];
    const hasError = !!s.error;

    if (isOpen) return renderSectionRow(s);

    return (
      <div
        key={s.id}
        className="rounded-xl border border-slate-200 bg-white p-4 hover:brightness-[0.99]"
      >
        <button
          type="button"
          onClick={() => toggleSection(s.id)}
          className="w-full text-left"
          title="Click to expand"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-800">{s.title}</div>
            </div>

            <div className="flex items-center gap-2">
              {s.optimizing && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                  Optimizing…
                </span>
              )}
              {hasOptimized && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-100">
                  Optimized
                </span>
              )}
              {hasConstraintsEdited && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                  Constraints Edited
                </span>
              )}
              {hasError && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-100">
                  Error
                </span>
              )}
              <span className="text-[11px] font-semibold text-slate-500">Expand</span>
            </div>
          </div>
        </button>
      </div>
    );
  };

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
        <h3 className="text-lg font-semibold">Original</h3>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!sections.length) {
                setNotice("No CV sections yet. Please parse the CV first.");
                return;
              }
              setCvSectionsConfirmed(true);
              setNotice(
                "CV sections confirmed. You can now Generate Preview / Replace All / Export."
              );
            }}
            disabled={autoOptimizing || parseBusy || !sections.length}
            className={`${ui.BTN_BASE} ${ui.BTN_SM} ${
              cvSectionsConfirmed
                ? "bg-emerald-600 text-white hover:brightness-105 ring-1 ring-emerald-600/10"
                : "bg-amber-500 text-amber-950 hover:brightness-105 ring-1 ring-amber-500/20"
            }`}
            title="Confirm CV parsing result"
          >
            {cvSectionsConfirmed ? "CV Sections Confirmed" : "Please Confirm Sections"}
          </button>

          <button
            type="button"
            onClick={async () => {
              await onAdjustStructure();
            }}
            disabled={autoOptimizing || parseBusy || !sections.length}
            className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_OUTLINE}`}
            title="Adjust section structure (resets confirmation and calls backend)"
          >
            Adjust structure
          </button>

          <button
            type="button"
            onClick={onReplaceAll}
            disabled={replaceAllDisabled || !cvSectionsConfirmed}
            className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_PRIMARY} ${gateDeemphasis}`}
            title={
              !cvSectionsConfirmed
                ? 'Please press "Confirm CV Sections" to confirm CV parsing result first.'
                : replaceAllDisabled
                ? "No optimized content to replace (or busy)."
                : "Replace original text with optimized text for all sections that have results."
            }
          >
            Replace All
          </button>

          <button
            type="button"
            onClick={onGeneratePreview}
            disabled={previewBusy || autoOptimizing || parseBusy || !cvSectionsConfirmed}
            className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_SECONDARY} ${gateDeemphasis}`}
            title={!cvSectionsConfirmed ? 'Please press "Confirm CV Sections" first.' : "Generate preview"}
          >
            {previewBusy ? "Generating…" : "Generate Preview"}
          </button>
        </div>

        <h3 className="text-lg font-semibold text-right">Optimized</h3>
      </div>

      <div className="mt-4 max-h-[70vh] overflow-y-auto pr-2">
        <div className="space-y-6">
          {roots.map((root) => {
            if (root.isGroup) {
              const children = childrenByParent.get(root.id) ?? [];
              const isOpen = openGroups[root.id] ?? true;

              return (
                <div key={root.id} className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => toggleGroup(root.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        title="Toggle group"
                      >
                        <span className="text-xs font-semibold text-slate-500">
                          {isOpen ? "▾" : "▸"}
                        </span>
                        <h4 className="min-w-0 truncate font-semibold text-slate-800">
                          {root.title}
                        </h4>
                      </button>

                      <span className="shrink-0 text-xs text-slate-500">
                        {children.length} items
                      </span>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="space-y-3">{children.map((c) => renderOutlineRow(c))}</div>
                  )}
                </div>
              );
            }

            return renderOutlineRow(root);
          })}
        </div>
      </div>
    </section>
  );
}
