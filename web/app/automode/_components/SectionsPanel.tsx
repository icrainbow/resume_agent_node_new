"use client";

import { useEffect, useMemo } from "react";
import type { Section } from "../_types/types";

console.error("🔥🔥🔥 THIS IS THE SECTIONS PANEL I AM EDITING 🔥🔥🔥");

type Props = {
  sections: Section[];
  roots: Section[];
  childrenByParent: Map<string, Section[]>;

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

  cvSectionsConfirmed: boolean;
  setCvSectionsConfirmed: (v: boolean) => void;

  autoOptimizing: boolean;
  parseBusy: boolean;
  previewBusy: boolean;
  replaceAllDisabled: boolean;

  gateDeemphasis: string;
  TEXT_BOX_H: string;
  jdText: string;
  constraintsDirtyById: Record<string, boolean>;

  progress: {
    running: boolean;
    current: number;
    total: number;
    currentTitle?: string;
  };

  setNotice: (v: string) => void;

  onAdjustStructure: () => Promise<void> | void;
  onReplaceAll: () => void;
  onGeneratePreview: () => Promise<void> | void;

  onOptimizeOne: (s: Section) => Promise<void> | void;
  onCloseSection: (id: string) => void;

  onSectionTextChange: (id: string, v: string) => void;
  onConstraintChange: (id: string, v: string) => void;
  onMergeReplaceOne: (id: string) => void;

  ui: {
    BTN_BASE: string;
    BTN_SM: string;
    BTN_XS: string;
    BTN_PRIMARY: string;
    BTN_SECONDARY: string;
    BTN_OUTLINE: string;
  };
};

function normalizeTitle(s: string | undefined | null) {
  return (s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

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

    setNotice,
    onAdjustStructure,
    onReplaceAll,
    onGeneratePreview,
    onSectionTextChange,

    ui,
  } = props;

  const effectiveRoots =
    roots.length === 0 && sections.length > 0 ? sections : roots;

  // ---- Build ids for init/reset (group + all sections we actually render) ----
  const groupIds = useMemo(() => {
    const ids: string[] = [];
    for (const r of effectiveRoots) if (r.isGroup) ids.push(r.id);
    return ids;
  }, [effectiveRoots]);

  const allSectionIds = useMemo(() => {
    const ids: string[] = [];
    for (const r of effectiveRoots) {
      // roots are also collapsible
      ids.push(r.id);

      if (r.isGroup) {
        const children = childrenByParent.get(r.id) ?? [];
        for (const c of children) ids.push(c.id);
      }
    }
    return Array.from(new Set(ids));
  }, [effectiveRoots, childrenByParent]);

  // ---- Reset open states on parse/adjust (sections change) ----
  useEffect(() => {
    setOpenGroups((prev) => {
      const next: Record<string, boolean> = {};
      for (const gid of groupIds) next[gid] = prev[gid] ?? false; // default collapsed
      return next;
    });

    setOpenById((prev) => {
      const next: Record<string, boolean> = {};
      for (const id of allSectionIds) next[id] = prev[id] ?? false; // default collapsed
      return next;
    });
  }, [groupIds, allSectionIds, setOpenGroups, setOpenById]);

  const toggleGroup = (groupId: string) =>
    setOpenGroups((prev) => ({ ...prev, [groupId]: !(prev[groupId] ?? false) }));

  const toggleSection = (id: string) =>
    setOpenById((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }));

  const renderSectionBody = (s: Section, showTitle: boolean) => {
    const isActionable = !s.isGroup;

    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          {showTitle && <h4 className="font-semibold">{s.title}</h4>}

          <textarea
            className={[
              showTitle ? "mt-2" : "",
              TEXT_BOX_H,
              "w-full resize-none rounded-lg bg-slate-50/60 p-3 text-sm",
              "ring-1 ring-slate-200",
            ]
              .filter(Boolean)
              .join(" ")}
            value={s.text}
            placeholder="(empty section – please edit)"
            onChange={(e) => onSectionTextChange(s.id, e.target.value)}
            disabled={!isActionable}
          />
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <pre className="whitespace-pre-wrap text-sm">
            {s.optimizedText || "—"}
          </pre>
        </div>
      </div>
    );
  };

  // Collapsible row, but label can be overridden (for flattened group case)
  const renderCollapsibleSection = (
    s: Section,
    labelOverride?: string,
    forceShowTitleInBody?: boolean
  ) => {
    const isOpen = openById[s.id] ?? false;

    return (
      <div key={s.id} className="space-y-3">
        <button
          type="button"
          onClick={() => toggleSection(s.id)}
          className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left font-semibold hover:bg-slate-50"
          title={isOpen ? "Collapse" : "Expand"}
        >
          <span className="truncate">{labelOverride ?? s.title}</span>
          <span className="ml-3 shrink-0 text-xs font-semibold text-slate-500">
            {isOpen ? "Hide" : "Show"}
          </span>
        </button>

        {isOpen ? (
          <div>{renderSectionBody(s, !!forceShowTitleInBody)}</div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-6">
      {/* ===== Action Bar ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
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
          >
            {cvSectionsConfirmed ? "CV Sections Confirmed" : "Please Confirm Sections"}
          </button>

          <button
            type="button"
            onClick={onAdjustStructure}
            disabled={autoOptimizing || parseBusy || !sections.length}
            className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_OUTLINE}`}
          >
            Adjust structure
          </button>

          <button
            type="button"
            onClick={onReplaceAll}
            disabled={replaceAllDisabled || !cvSectionsConfirmed}
            className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_PRIMARY} ${gateDeemphasis}`}
          >
            Replace All
          </button>

          <button
            type="button"
            onClick={onGeneratePreview}
            disabled={previewBusy || autoOptimizing || parseBusy || !cvSectionsConfirmed}
            className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_SECONDARY} ${gateDeemphasis}`}
          >
            {previewBusy ? "Generating…" : "Generate Preview"}
          </button>
        </div>
      </div>

      {/* ===== Sections ===== */}
      <div className="space-y-6">
        {effectiveRoots.map((root) => {
          // Non-group roots: collapsible normally
          if (!root.isGroup) {
            return renderCollapsibleSection(root, undefined, true);
          }

          // Group roots:
          const children = childrenByParent.get(root.id) ?? [];

          // ✅ Flatten case: single child and (almost) same title
          if (
            children.length === 1 &&
            normalizeTitle(children[0].title) === normalizeTitle(root.title)
          ) {
            // show ONLY ONE row, label is the group title, body is the child's content
            return (
              <div key={root.id} className="space-y-4">
                {renderCollapsibleSection(children[0], root.title, false)}
              </div>
            );
          }

          // Normal case: show group header + children list
          const isGroupOpen = openGroups[root.id] ?? false;

          return (
            <div key={root.id} className="space-y-4">
              <button
                type="button"
                onClick={() => toggleGroup(root.id)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left font-semibold hover:bg-slate-50"
                title={isGroupOpen ? "Collapse group" : "Expand group"}
              >
                <span className="truncate">{root.title}</span>
                <span className="ml-3 shrink-0 text-xs font-semibold text-slate-500">
                  {isGroupOpen ? "Hide" : "Show"}
                </span>
              </button>

              {isGroupOpen ? (
                <div className="space-y-4">
                  {children.map((c) => renderCollapsibleSection(c, undefined, false))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
