"use client";

import type { RefObject } from "react";
import type {
  DebugEntry,
  ExportResp,
  OptimizeApiResp,
  ParseResp,
  PdfApiResp,
  Section,
} from "../../_types/types";

/**
 * Keep these controller-local types in one place so the controller and actions
 * share a single source of truth.
 */

export type Progress = {
  running: boolean;
  current: number;
  total: number;
  currentTitle?: string;
};

export type ExportLinks = { pdf?: string; docx?: string } | null;

export type State = {
  // files / inputs
  resumeFile: File | null;
  schemaFile: File | null;
  jdFile: File | null;
  jdText: string;

  // primary
  sections: Section[];
  jobId: string;

  // UI
  notice: string;
  parseBusy: boolean;
  autoOptimizing: boolean;
  previewUrl: string;
  previewBusy: boolean;
  previewDirty: boolean;
  exportBusy: boolean;
  exportLinks: ExportLinks;
  progress: Progress;

  // folding
  openById: Record<string, boolean>;
  openGroups: Record<string, boolean>;

  // gates
  cvSectionsConfirmed: boolean;

  // schema / chat
  chatVisible: boolean;
  schemaDirty: boolean;
  pendingRequirements: any;
  currentSchema: any;
  currentSchemaDebug: any;
  schemaProvidedByUser: boolean;

  // schema audit
  schemaRawText: string;

  // debug panel
  debugOn: boolean;
  debugExpanded: boolean;
  debugEntries: DebugEntry[];
  debugReqText: string;
  debugSchemaOld: any;
  debugSchemaNew: any;
  debugPromptText: string;

  // whole-cv notes
  wholeCvNotes: string;
};

export type Action =
  | { type: "SET"; patch: Partial<State> }
  | { type: "RESET_ALL"; defaultWholeCvNotes: string }
  | {
      type: "SET_SECTIONS";
      sections: Section[];
      openById: Record<string, boolean>;
      openGroups: Record<string, boolean>;
      confirmed?: boolean;
    };

export type Dispatch = (a: Action) => void;

export type ControllerOpts = {
  DEFAULT_WHOLE_CV_NOTES: string;
  resumeInputRef: RefObject<HTMLInputElement | null>;
  schemaInputRef: RefObject<HTMLInputElement | null>;
  jdInputRef: RefObject<HTMLInputElement | null>;
};

/** Shared API response shapes */
export type {
  DebugEntry,
  ExportResp,
  OptimizeApiResp,
  ParseResp,
  PdfApiResp,
  Section,
};

/**
 * Refs used by actions (to avoid stale closures)
 *
 * NOTE:
 * parseTokenRef is used to prevent stale/late parse responses from overwriting
 * the UI state after the user has selected a new file.
 */
export type ControllerRefs = {
  sectionsRef: React.MutableRefObject<Section[]>;
  schemaRawTextRef: React.MutableRefObject<string>;
  jobIdRef: React.MutableRefObject<string>;
  jdBaselineRef: React.MutableRefObject<string>;
  constraintsBaselineRef: React.MutableRefObject<Record<string, string>>;
  wholeCvNotesBaselineRef: React.MutableRefObject<string>;

  // NEW: request guard token for parse
  parseTokenRef: React.MutableRefObject<string>;
};
