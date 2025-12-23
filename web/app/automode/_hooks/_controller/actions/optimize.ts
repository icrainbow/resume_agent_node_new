"use client";

import type { Dispatch, State } from "../types";
import type { OptimizeApiResp } from "../../../_types/types";
import { fetchJsonDebug } from "../../../_utils/fetch";
import { ensureJobId } from "../job";
import { requireCvSectionsConfirmed, requireJdText } from "../gates";

export async function optimizeOneAction(args: {
  id: string;
  st: State;
  dispatch: Dispatch;
  fetchDbg: { debugOn: boolean; pushEntry: (e: any) => void };
  jobIdRef: React.MutableRefObject<string>;
  sectionsRef: React.MutableRefObject<any[]>;
}) {
  const { id, st, dispatch, fetchDbg, jobIdRef, sectionsRef } = args;

  if (!requireCvSectionsConfirmed(st, dispatch, sectionsRef.current.length)) return;
  if (!requireJdText(st, dispatch)) return;

  dispatch({ type: "SET", patch: { notice: "Optimizing section…" } });

  try {
    const jid = ensureJobId({ st, dispatch, jobIdRef });
    const target = (sectionsRef.current || []).find((s: any) => s.id === id);
    if (!target) throw new Error("Section not found.");

    const payload = {
      job_id: jid,
      mode: "one",
      section: {
        id: target.id,
        title: target.title,
        text: target.text,
        constraints: target.constraints || "",
      },
      jd_text: st.jdText,
      whole_cv_notes: st.wholeCvNotes,
    };

    const meta = { job_id: jid, section_id: id };

    const { status, json } = await fetchJsonDebug<OptimizeApiResp>(
      "opt-one",
      "/api/optimize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      meta,
      fetchDbg
    );

    const data: OptimizeApiResp = (json || {}) as any;
    if (!data?.ok) throw new Error(data?.error || `Optimize failed (HTTP ${status})`);

    const optimized =
      data?.sections?.[0]?.optimized_text ?? (data as any)?.optimized_text ?? "";

    const next = (st.sections || []).map((s: any) =>
      s.id === id ? { ...s, optimizedText: String(optimized || "") } : s
    );
    dispatch({ type: "SET", patch: { sections: next, notice: "Section optimized." } });
  } catch (e: any) {
    dispatch({ type: "SET", patch: { notice: e?.message || "Optimize section failed." } });
  }
}

export async function optimizeWholeCVAction(args: {
  st: State;
  dispatch: Dispatch;
  fetchDbg: { debugOn: boolean; pushEntry: (e: any) => void };
  jobIdRef: React.MutableRefObject<string>;
  sectionsRef: React.MutableRefObject<any[]>;
}) {
  const { st, dispatch, fetchDbg, jobIdRef, sectionsRef } = args;

  if (!requireCvSectionsConfirmed(st, dispatch, sectionsRef.current.length)) return;
  if (!requireJdText(st, dispatch)) return;
  if (st.autoOptimizing) return;

  const all = sectionsRef.current || [];
  if (!all.length) {
    dispatch({
      type: "SET",
      patch: { notice: 'Please parse the CV first (click "Parse CV").' },
    });
    return;
  }

  const actionable = all.filter((s: any) => !s.isGroup && (s.text || "").trim());
  const total = actionable.length;

  if (!total) {
    dispatch({
      type: "SET",
      patch: {
        notice: "No actionable sections found (all sections are empty or groups).",
      },
    });
    return;
  }

  const jid = ensureJobId({ st, dispatch, jobIdRef });

  const constraintsMap: Record<string, string> = {};
  for (const s of actionable) constraintsMap[s.id] = s.constraints || "";

  const patchSection = (id: string, patch: any) => {
    const next = (sectionsRef.current || []).map((x: any) =>
      x.id === id ? { ...x, ...patch } : x
    );
    sectionsRef.current = next;
    dispatch({ type: "SET", patch: { sections: next } });
  };

  const openSection = (id: string) => {
    dispatch({
      type: "SET",
      patch: { openById: { ...(st.openById || {}), [id]: true } },
    });
  };

  dispatch({
    type: "SET",
    patch: {
      autoOptimizing: true,
      progress: {
        running: true,
        current: 1,
        total,
        currentTitle: actionable[0]?.title,
      },
      notice: `Optimizing whole CV (sequential)… 1/${total}`,
    },
  });

  try {
    for (let i = 0; i < total; i++) {
      const current = actionable[i];
      if (!current) continue;

      dispatch({
        type: "SET",
        patch: {
          progress: {
            running: true,
            current: i + 1,
            total,
            currentTitle: current.title,
          },
          notice: `Optimizing whole CV (sequential)… ${i + 1}/${total}`,
        },
      });

      patchSection(current.id, { optimizing: true, error: undefined });

      try {
        const payload = {
          job_id: jid,
          sections: [{ id: current.id, title: current.title, text: current.text }],
          jd_text: st.jdText,
          constraints: constraintsMap,
          global_instructions: st.wholeCvNotes,
        };

        const { status, json } = await fetchJsonDebug<OptimizeApiResp>(
          "optimize-whole-step",
          "/api/optimize",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          { job_id: jid, step: `${i + 1}/${total}`, sectionId: current.id, title: current.title },
          fetchDbg
        );

        const data: OptimizeApiResp = (json || {}) as any;
        if (!data?.ok) throw new Error(data?.error || `Optimize failed (HTTP ${status})`);

        const optimized = data.sections?.[0]?.optimized_text || "";
        if (!optimized.trim()) throw new Error("Optimization returned empty content.");

        patchSection(current.id, { optimizedText: optimized });
        openSection(current.id);
      } catch (e: any) {
        patchSection(current.id, { error: e?.message || "Optimize step failed." });
      } finally {
        patchSection(current.id, { optimizing: false });
      }
    }

    dispatch({
      type: "SET",
      patch: {
        notice: `Whole CV optimization finished. job_id=${jid}. Review and merge as needed.`,
      },
    });
  } finally {
    dispatch({
      type: "SET",
      patch: {
        autoOptimizing: false,
        progress: { running: false, current: 0, total: 0 },
      },
    });
  }
}
