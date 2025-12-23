"use client";

type Props = {
  resumeFile: File | null;
};

export default function EmptyState({ resumeFile }: Props) {
  return (
    <div className="flex h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <img
        src="/illustrations/resume-pipeline.png"
        alt="AI resume pipeline"
        className="max-h-[48vh] w-full max-w-[720px] object-contain opacity-95"
        draggable={false}
      />

      <div className="max-w-xl">
        <div className="text-lg font-semibold text-slate-800">
          {resumeFile ? "Upload Schema, then click Parse CV" : "Upload your CV to begin"}
        </div>

        <div className="mt-2 text-sm text-slate-600">
          1) Upload a CV (.pdf / .docx).
          <br />
          2) Upload a Schema (.json) <span className="font-semibold">(required)</span>.
          <br />
          3) Click <span className="font-semibold">Parse CV</span> to split into sections (schema-driven).
          <br />
          4) Upload a JD to auto-load JD text (editable), then optimize per section or run Whole CV optimization.
        </div>
      </div>
    </div>
  );
}
