"use client";

import type { MutableRefObject } from "react";

import type { Dispatch, State } from "./types";
import { newJobId } from "./controller_helpers";

/**
 * Ensure there is a job_id:
 * - Uses jobIdRef to avoid stale closures in async actions
 * - If needed, writes both jobIdRef + state.jobId
 */
export function ensureJobId(args: {
  st: State;
  dispatch: Dispatch;
  jobIdRef: MutableRefObject<string>;
}) {
  const { st, dispatch, jobIdRef } = args;

  const jid = jobIdRef.current || st.jobId || newJobId();
  if (!jobIdRef.current) jobIdRef.current = jid;
  if (!st.jobId) dispatch({ type: "SET", patch: { jobId: jid } });
  return jid;
}
