// web/app/automode/_hooks/_controller/actions/dev_bootstrap.ts
"use client";

import type { State } from "../types";
import type { Section } from "../../../_types/types";

type Args = {
  st: State;
  dispatch: (a: any) => void;

  // reuse your existing schema commit (validate only)
  commitSchemaCandidateOrBlock: (args: {
    candidate: any;
    source:
      | "user_upload"
      | "parse_baseline"
      | "adjust_structure"
      | "chat"
      | "unknown";
    onAccepted?: (validated: any) => void;
    onBlocked?: (validation: any) => void;
  }) => boolean;

  // optional: run parse automatically after bootstrap
  parseCv?: () => Promise<any>;
};

async function fetchAsText(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to fetch ${url} (HTTP ${r.status})`);
  return await r.text();
}

async function fetchAsBlob(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to fetch ${url} (HTTP ${r.status})`);
  return await r.blob();
}

// web/app/automode/_hooks/_controller/actions/dev_bootstrap.ts
export async function devBootstrapAction(args: Args) {
  const { dispatch, commitSchemaCandidateOrBlock, parseCv } = args;

  // 1) Fetch dev fixtures from /public
  const [schemaText, jdText, resumeBlob] = await Promise.all([
    fetchAsText("/dev/bootstrap.schema.json"),
    fetchAsText("/dev/bootstrap.jd.txt"),
    fetchAsBlob("/dev/bootstrap.resume.docx"),
  ]);

  // 2) Build File objects to simulate user upload
  const resumeFile = new File([resumeBlob], "bootstrap.resume.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const schemaFile = new File([schemaText], "bootstrap.schema.json", {
    type: "application/json",
  });

  const jdFile = new File([jdText], "bootstrap.jd.txt", { type: "text/plain" });

  // 3) Parse schema JSON
  let schemaObj: any;
  try {
    schemaObj = JSON.parse(schemaText);
  } catch {
    dispatch({
      type: "SET",
      patch: {
        notice:
          "Dev bootstrap: bootstrap.schema.json is not valid JSON. Fix /public/dev/bootstrap.schema.json.",
      },
    });
    throw new Error("bootstrap.schema.json is not valid JSON.");
  }

  // ✅ Normalize schema (align with schema_upload.tsx)
  const normalized = {
    ...schemaObj,
    sections: (schemaObj.sections || []).map((s: any) => ({
      ...s,
      isGroup: typeof s.isGroup === "boolean" ? s.isGroup : false,
    })),
  };

  // 4) First set files + jdText + raw schema text
  // NOTE: dispatch is async; state updates apply on next render.
  dispatch({
    type: "SET",
    patch: {
      resumeFile,
      schemaFile,
      jdFile,
      jdText,
      schemaRawText: schemaText,
      notice: "Dev bootstrap: files loaded. Validating schema…",
    },
  });

  // 5) Validate/commit schema using your existing fail-closed validator
  const accepted = commitSchemaCandidateOrBlock({
    candidate: normalized,
    source: "user_upload",
    onAccepted: (validated) => {
      dispatch({
        type: "SET",
        patch: {
          schemaProvidedByUser: true,
          currentSchema: validated,
          // Keep debug visible while iterating
          currentSchemaDebug: validated,
          schemaDirty: false,
          pendingRequirements: null,
          notice: 'Dev bootstrap: schema accepted. Now click "Parse CV".',
        },
      });
    },
    onBlocked: () => {
      dispatch({
        type: "SET",
        patch: {
          schemaProvidedByUser: false,
          currentSchema: null,
          currentSchemaDebug: null,
          notice:
            "Dev bootstrap: schema blocked (invalid). Fix /public/dev/bootstrap.schema.json.",
        },
      });
    },
  });

  if (!accepted) return;

  /**
   * 6) IMPORTANT: Do NOT auto-run parse here.
   *
   * Reason:
   * - parseCv() is created in the controller render and closes over `st`.
   * - Inside this same async call stack, even after dispatch, calling parseCv()
   *   will often use a stale `st` (resumeFile/schemaFile/jdText still appear empty),
   *   which looks like "state got swallowed".
   *
   * Instead, we leave the app in a valid "ready to parse" state, and you click Parse CV
   * so parseCv is invoked from the next render with up-to-date state.
   */
  if (parseCv) {
    dispatch({
      type: "SET",
      patch: {
        notice:
          'Dev bootstrap: ready. Click "Parse CV" (auto-parse is disabled to avoid stale state).',
      },
    });
  }
}
