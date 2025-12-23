"use client";

import type { Dispatch, State } from "./types";

/**
 * Gate helpers:
 * - Keep them pure (no reads outside args)
 * - Always return boolean and set notice via dispatch if blocked
 */

export function setNotice(dispatch: Dispatch, notice: string) {
  dispatch({ type: "SET", patch: { notice } });
}

export function requireJdText(st: State, dispatch: Dispatch): boolean {
  if (!st.jdText.trim()) {
    setNotice(
      dispatch,
      "JD text is empty. Please upload a JD or paste JD text before optimizing."
    );
    return false;
  }
  return true;
}

export function requireCvSectionsConfirmed(
  st: State,
  dispatch: Dispatch,
  sectionsLen: number
): boolean {
  if (!sectionsLen) {
    setNotice(dispatch, 'Please parse the CV first (click "Parse CV").');
    return false;
  }
  if (!st.cvSectionsConfirmed) {
    setNotice(
      dispatch,
      'Please press "Confirm CV Sections" to confirm CV parsing result first.'
    );
    return false;
  }
  return true;
}
