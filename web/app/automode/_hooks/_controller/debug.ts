"use client";

import type { Dispatch, State } from "./types";
import type { DebugEntry } from "../../_types/types";
import { nowIso } from "../../_utils/utils";
import { validateSchema } from "@/lib/architect/schema_sanity";

/**
 * Debug adapter:
 * - pushDebugEntry: prepends to debugEntries, truncates to 40
 * - commitSchemaCandidateOrBlock: validate-only (fail-closed), never auto-fix
 */

export function pushDebugEntry(st: State, dispatch: Dispatch, entry: DebugEntry) {
  dispatch({
    type: "SET",
    patch: { debugEntries: [entry, ...(st.debugEntries || [])].slice(0, 40) },
  });
}

export function commitSchemaCandidateOrBlock(args: {
  st: State;
  dispatch: Dispatch;
  candidate: any;
  source:
    | "user_upload"
    | "parse_baseline"
    | "adjust_structure"
    | "chat"
    | "unknown";
  onAccepted?: (validated: any) => void;
  onBlocked?: (validation: ReturnType<typeof validateSchema>) => void;
}) {
  const { st, dispatch, candidate, source, onAccepted, onBlocked } = args;
  const v = validateSchema(candidate);

  if (!v.ok) {
    const codes = v.errors.map((e) => e.code).join(", ");
    dispatch({
      type: "SET",
      patch: { notice: `Schema invalid (blocked from ${source}). Errors: ${codes}` },
    });

    try {
      pushDebugEntry(st, dispatch, {
        ts: nowIso(),
        tag: "schema_sanity",
        ok: false,
        msg: `Blocked schema from ${source}: ${codes}`,
        meta: { source, errors: v.errors, warnings: v.warnings },
      } as any);
    } catch {
      // ignore debug failures
    }

    onBlocked?.(v);
    return false;
  }

  if (v.warnings.length) {
    const w = v.warnings.map((x) => x.code).join(", ");
    dispatch({
      type: "SET",
      patch: { notice: `Schema accepted with warnings: ${w}` },
    });

    try {
      pushDebugEntry(st, dispatch, {
        ts: nowIso(),
        tag: "schema_sanity",
        ok: true,
        msg: `Accepted schema from ${source} with warnings: ${w}`,
        meta: { source, warnings: v.warnings },
      } as any);
    } catch {
      // ignore
    }
  }

  onAccepted?.(candidate);
  return true;
}
