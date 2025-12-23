"use client";

type Props = {
  previewUrl: string;
  previewDirty: boolean;
  previewBusy: boolean;

  exportBusy: boolean;
  autoOptimizing: boolean;
  parseBusy: boolean;
  cvSectionsConfirmed: boolean;
  gateDeemphasis: string;

  exportLinks: { pdf?: string; docx?: string } | null;

  onGenerateCv: () => Promise<void> | void;
  onRefreshPreview: () => Promise<void> | void;
  onClosePreview: () => void;

  ui: {
    BTN_BASE: string;
    BTN_SM: string;
    BTN_PRIMARY: string;
    BTN_SECONDARY: string;
    BTN_OUTLINE: string;
  };
};

export default function PreviewPanel(props: Props) {
  const {
    previewUrl,
    previewDirty,
    previewBusy,
    exportBusy,
    autoOptimizing,
    parseBusy,
    cvSectionsConfirmed,
    gateDeemphasis,
    exportLinks,
    onGenerateCv,
    onRefreshPreview,
    onClosePreview,
    ui,
  } = props;

  if (!previewUrl) return null;

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-slate-800">Preview</div>
          {previewDirty && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
              Outdated
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onGenerateCv}
            disabled={exportBusy || autoOptimizing || parseBusy || !cvSectionsConfirmed}
            className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_PRIMARY} ${gateDeemphasis}`}
            title={
              !cvSectionsConfirmed
                ? 'Please press "Confirm CV Sections" first.'
                : "Generate downloadable CV files (PDF + DOCX)"
            }
          >
            {exportBusy ? "Generating…" : "Generate CV"}
          </button>

          {exportLinks?.pdf && exportLinks?.docx && (
            <div className="flex items-center gap-2">
              <a
                href={exportLinks.pdf}
                target="_blank"
                rel="noreferrer"
                className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_OUTLINE}`}
              >
                Download PDF
              </a>
              <a
                href={exportLinks.docx}
                target="_blank"
                rel="noreferrer"
                className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_OUTLINE}`}
              >
                Download DOCX
              </a>
            </div>
          )}

          <button
            type="button"
            onClick={onRefreshPreview}
            disabled={previewBusy || autoOptimizing || parseBusy || !cvSectionsConfirmed}
            className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_SECONDARY} ${gateDeemphasis}`}
            title={!cvSectionsConfirmed ? 'Please press "Confirm CV Sections" first.' : "Refresh the preview"}
          >
            {previewDirty ? "Refresh (Regenerate)" : "Refresh"}
          </button>

          <button
            type="button"
            onClick={onClosePreview}
            className={`${ui.BTN_BASE} ${ui.BTN_SM} ${ui.BTN_SECONDARY}`}
          >
            Close
          </button>
        </div>
      </div>

      <div className="h-[55vh] w-full">
        <iframe
          key={previewUrl}
          src={previewUrl}
          className="h-full w-full"
          style={{ border: "none" }}
          title="Resume Preview"
        />
      </div>
    </div>
  );
}
