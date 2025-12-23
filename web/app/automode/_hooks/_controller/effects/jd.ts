// web/app/automode/_hooks/_controller/effects/jd.ts
"use client";

import { useEffect } from "react";

import type { ParseResp } from "../../../_types/types";
import { fetchJsonDebug } from "../../../_utils/fetch";

import type { Dispatch, State } from "../types";

export function useParseJdEffect(args: {
  st: State;
  dispatch: Dispatch;
  fetchDbg: { debugOn: boolean; pushEntry: (e: any) => void };
  jdBaselineRef: React.MutableRefObject<string>;
}) {
  const { st, dispatch, fetchDbg, jdBaselineRef } = args;

  useEffect(() => {
    const file = st.jdFile;
    if (!file) return;

    (async () => {
      dispatch({ type: "SET", patch: { notice: "Parsing JD…" } });

      try {
        const fd = new FormData();
        fd.append("jd", file);

        const meta = { fileName: file.name, size: file.size, type: file.type };

        const { status, json } = await fetchJsonDebug<ParseResp>(
          "parse-jd",
          "/api/parse/jd",
          { method: "POST", body: fd },
          meta,
          fetchDbg
        );

        const data: ParseResp = (json || {}) as any;
        if (!data?.ok) {
          const err = data?.error || `JD parse failed (HTTP ${status})`;
          const rawLen = (data?.raw_text || "").length;
          dispatch({
            type: "SET",
            patch: { notice: `${err}. raw_text_len=${rawLen}` },
          });
          return;
        }

        const finalText = (data.jd_text || "").toString().trim();
        if (!finalText) {
          dispatch({
            type: "SET",
            patch: {
              notice:
                "JD parsed but returned empty jd_text. Please re-upload or paste JD text.",
            },
          });
          return;
        }

        dispatch({
          type: "SET",
          patch: {
            jdText: finalText,
            notice: `JD loaded. chars=${finalText.length}. You may edit the JD text before optimizing.`,
          },
        });

        jdBaselineRef.current = finalText;
      } catch (e: any) {
        dispatch({
          type: "SET",
          patch: { notice: e?.message || "Failed to parse JD." },
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.jdFile]);
}
