"use client";

/**
 * UI tokens are kept in one place so Page and controller actions reuse the same
 * class strings and do not drift.
 */

export const BTN_BASE =
  "inline-flex items-center justify-center rounded-xl font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed";
export const BTN_SM = "h-9 px-3 text-sm";
export const BTN_XS = "h-7 px-2 text-xs";

export const BTN_PRIMARY =
  "bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950";
export const BTN_SECONDARY =
  "bg-slate-100 text-slate-900 hover:bg-slate-200 active:bg-slate-300";
export const BTN_OUTLINE =
  "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 active:bg-slate-100";

export const TEXT_BOX_H_DEFAULT = "h-[19rem]";
