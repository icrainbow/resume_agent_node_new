"use client";

import type { DebugEntry } from "../../../_types/types";
import type { Dispatch, State } from "../types";
import {
  BTN_BASE,
  BTN_OUTLINE,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SM,
  BTN_XS,
  TEXT_BOX_H_DEFAULT,
} from "./ui_tokens";

export function buildInputsPanelUI() {
  return {
    BTN_BASE,
    BTN_SM,
    BTN_XS,
    BTN_PRIMARY,
    BTN_SECONDARY,
    BTN_OUTLINE,
  };
}

export function buildDebugPanelModel(st: State, dispatch: Dispatch) {
  return {
    debugOn: st.debugOn,
    setDebugOn: (updater: boolean | ((prev: boolean) => boolean)) => {
      const next =
        typeof updater === "function" ? (updater as any)(st.debugOn) : updater;
      dispatch({ type: "SET", patch: { debugOn: next } });
    },
    debugExpanded: st.debugExpanded,
    setDebugExpanded: (updater: boolean | ((prev: boolean) => boolean)) => {
      const next =
        typeof updater === "function"
          ? (updater as any)(st.debugExpanded)
          : updater;
      dispatch({ type: "SET", patch: { debugExpanded: next } });
    },
    debugEntries: st.debugEntries,
    setDebugEntries: (
      updater: DebugEntry[] | ((prev: DebugEntry[]) => DebugEntry[])
    ) => {
      const next =
        typeof updater === "function"
          ? (updater as any)(st.debugEntries)
          : updater;
      dispatch({ type: "SET", patch: { debugEntries: next } });
    },
    debugReqText: st.debugReqText,
    setDebugReqText: (v: string) =>
      dispatch({ type: "SET", patch: { debugReqText: v } }),
    debugSchemaOld: st.debugSchemaOld,
    setDebugSchemaOld: (v: any) =>
      dispatch({ type: "SET", patch: { debugSchemaOld: v } }),
    debugSchemaNew: st.debugSchemaNew,
    setDebugSchemaNew: (v: any) =>
      dispatch({ type: "SET", patch: { debugSchemaNew: v } }),
    debugPromptText: st.debugPromptText,
    setDebugPromptText: (v: string) =>
      dispatch({ type: "SET", patch: { debugPromptText: v } }),
  };
}

export function buildDebugPanelUI() {
  return {
    BTN_BASE,
    BTN_SM,
    BTN_XS,
    BTN_PRIMARY,
    BTN_SECONDARY,
    BTN_OUTLINE,
    TEXT_BOX_H: TEXT_BOX_H_DEFAULT,
  };
}

export function buildSectionsPanelUI() {
  return {
    BTN_BASE,
    BTN_SM,
    BTN_XS,
    BTN_PRIMARY,
    BTN_SECONDARY,
    BTN_OUTLINE,
    TEXT_BOX_H: TEXT_BOX_H_DEFAULT,
  };
}

export function gateDeemphasis(cvSectionsConfirmed: boolean) {
  return !cvSectionsConfirmed ? "opacity-90" : "opacity-100";
}
