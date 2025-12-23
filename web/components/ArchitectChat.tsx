// web/components/ArchitectChat.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NextSuggestedAction } from "@/lib/architect/contracts";

type ChatMsg = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatRole = ChatMsg["role"];

function msg(role: ChatRole, content: string): ChatMsg {
  return { role, content };
}


type ArchitectChatProps = {
  currentSchema: any;

  // MVP
  visible: boolean;
  cvSectionsConfirmed: boolean;
  schemaDirty: boolean;
  pendingReq: any;

  // keep props for backward compatibility / easy rollback
  onConfirm: () => void;
  onAdjust: () => void;

  onChatUpdate: (u: {
    pending_requirements: any;
    schema_dirty: boolean;
    next_suggested_action: NextSuggestedAction;
  }) => void;
};

const CHAT_API = "/api/architect";

function nowIso() {
  return new Date().toISOString();
}

const BTN_OUTLINE =
  "bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50";

function safeStringify(obj: any, space = 2) {
  try {
    return JSON.stringify(obj, null, space);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Stable outline signature:
 * - Avoid random key order issues by stringifying only a normalized array.
 * - space=0 by default to keep it short.
 */
function stableOutlineSig(outline: any, space = 0) {
  try {
    if (!Array.isArray(outline)) return "";
    const norm = outline.map((s: any) => ({
      id: String(s?.id ?? ""),
      title: String(s?.title ?? ""),
      parentId: s?.parentId ?? null,
      isGroup: !!s?.isGroup,
    }));
    return JSON.stringify(norm, null, space);
  } catch {
    return "";
  }
}

export default function ArchitectChat(props: ArchitectChatProps) {
  const {
    currentSchema,
    visible,
    cvSectionsConfirmed,
    schemaDirty,
    pendingReq,
    // keep for rollback; not used in Scheme A UI, but keep the contract stable
    onConfirm: _onConfirm,
    onAdjust: _onAdjust,
    onChatUpdate,
  } = props;

  /* =========================
     State & refs (hooks MUST always run)
  ========================= */

  const [open, setOpen] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [input, setInput] = useState<string>("");
  const [netError, setNetError] = useState<string>("");

  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* =========================
     Derived data
  ========================= */

  const schemaContext = useMemo(() => {
    const sections = Array.isArray(currentSchema?.sections)
      ? currentSchema.sections
      : [];
    return {
      job_id: currentSchema?.job_id ?? "",
      jd_text_len: (currentSchema?.jd_text ?? "").length,
      sections_outline: sections.map((s: any) => ({
        id: s?.id,
        title: s?.title,
        parentId: s?.parentId ?? null,
        isGroup: !!s?.isGroup,
      })),
    };
  }, [currentSchema]);

  const systemPrompt = useMemo(() => {
    return `
You are the "Resume Architect" assistant in a strict MVP.

Non-negotiable rules:
1) You MUST NOT finalize CV sections. The only finalize path is the UI button "Confirm CV Sections".
2) You MUST NOT generate schema or re-split in chat mode. Only guide user to click "Adjust structure" and to describe desired changes in natural language.
3) Chat mode output must include:
   - assistant_message
   - pending_requirements
   - schema_dirty
   - next_suggested_action

Never output schema JSON in chat mode.
`.trim();
  }, []);

  const [messages, setMessages] = useState<ChatMsg[]>(() => [
    msg("system", systemPrompt),
  ]);
  

  /* =========================
     Effects
  ========================= */

  useEffect(() => {
    setMessages((prev): ChatMsg[] => {
      if (prev.length && prev[0].role === "system") {
        const next = [...prev];
        next[0] = msg("system", systemPrompt);
        return next;
      }
      return [msg("system", systemPrompt), ...prev];
    });
  }, [systemPrompt]);
    

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open, visible, netError]);

  /**
   * ✅ Welcome seeding:
   * Show a first assistant message when chat becomes visible.
   * - No backend call (avoids overwriting backend state)
   * - StrictMode safe
   * - Re-seeds per job_id (or outline signature)
   */
  const welcomedKeyRef = useRef<string>("");

  const welcomeText = useMemo(() => {
    const hasSections = (schemaContext.sections_outline?.length || 0) > 0;
    const confirmed = !!cvSectionsConfirmed;
    const dirty = !!schemaDirty;

    const lines: string[] = [];
    lines.push("Hi — I’m Resume Architect.");

    if (!hasSections) {
      lines.push(
        "I don’t see CV sections yet. Please click “Parse CV” first so I can reference your current structure."
      );
    } else if (!confirmed) {
      lines.push(
        "Please review the current section split on the page. When it looks correct, click “Confirm CV Sections”."
      );
      lines.push(
        "If you want to change the structure, tell me what you want (e.g., merge/split/reorder sections). I will prepare the change request and guide you to click “Adjust structure”."
      );
    } else {
      lines.push(
        "Sections are confirmed. If you want to change structure, describe what to change and I’ll guide you to “Adjust structure”."
      );
    }

    if (dirty) {
      lines.push(
        "Note: I already have a structure draft in progress (badge: “Structure draft”). You can continue refining it here."
      );
    }

    return lines.join("\n");
  }, [schemaContext.sections_outline, cvSectionsConfirmed, schemaDirty]);

  useEffect(() => {
    if (!visible) return;

    const jobId = String(currentSchema?.job_id || "");
    const outlineSig = stableOutlineSig(schemaContext.sections_outline, 0);
    const seedKey = jobId ? `job:${jobId}` : `outline:${outlineSig}`;

    if (welcomedKeyRef.current === seedKey) return;
    welcomedKeyRef.current = seedKey;

    setMessages((prev): ChatMsg[] => {
        const hasAssistant = prev.some((m) => m.role === "assistant");
        if (hasAssistant) return prev;
        const next = [...prev, msg("assistant", welcomeText)];
        return next.slice(-60);
      });
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentSchema?.job_id, schemaContext.sections_outline, welcomeText]);

   
  /* =========================
     API
  ========================= */

  function normalizePendingReq(v: any): string {
    if (typeof v === "string") return v.trim();
    if (v == null) return "";
    try {
      return JSON.stringify(v);
    } catch {
      try {
        return String(v).trim();
      } catch {
        return "";
      }
    }
  }

  async function callChatApi(userText: string, historySnapshot: ChatMsg[]) {
    const text = (userText ?? "").trim();
    if (!text) return;

    if (busy) return;
    setBusy(true);
    setNetError("");

    const convo = (historySnapshot || []).filter((m) => m.role !== "system");
    const pendingReqStr = normalizePendingReq(pendingReq);

    const payload = {
      action: "chat" as const,
      ts: nowIso(),

      current: {
        job_id: currentSchema?.job_id ?? "",
        jd_text: currentSchema?.jd_text ?? "",
        sections: Array.isArray(currentSchema?.sections)
          ? currentSchema.sections
          : [],
      },

      state: {
        pending_requirements: pendingReqStr,
        schema_dirty: !!schemaDirty,
      },

      messages: [
        { role: "system" as const, content: systemPrompt },
        {
          role: "system" as const,
          content: `Context:\n${safeStringify(
            {
              ...schemaContext,
              schema_dirty: !!schemaDirty,
              pending_requirements_len: pendingReqStr.length,
              cv_sections_confirmed: !!cvSectionsConfirmed,
            },
            2
          )}`,
        },
        ...convo,
        { role: "user" as const, content: text },
      ],
    };

    // eslint-disable-next-line no-console
    console.log("[ArchitectChat] POST /api/architect", {
      job_id: payload.current.job_id,
      sections: Array.isArray(payload.current.sections)
        ? payload.current.sections.length
        : 0,
      pending_requirements_len: (payload.state.pending_requirements || "")
        .length,
      schema_dirty: payload.state.schema_dirty,
      cv_sections_confirmed: !!cvSectionsConfirmed,
    });

    try {
      const r = await fetch(CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const raw = await r.text();
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = null;
      }

      if (!r.ok) {
        const msg = (json?.error || json?.message || raw || `HTTP ${r.status}`)
          .toString();
        setNetError(msg);
        setMessages((prev) => {
          const next = [
            ...prev,
            {
              role: "assistant" as const,
              content:
                "Architect service returned an error. Please check Debug Panel → Recent Requests for /api/architect.\n" +
                `Error: ${msg}`,
            },
          ];
          return next.slice(-60);
        });
        return;
      }

      const assistantText = (json?.assistant_message || json?.message || "")
        .toString();
        if (assistantText) {
            setMessages((prev): ChatMsg[] => {
              const next = [...prev, msg("assistant", assistantText)];
              return next.slice(-60);
            });
          }
          

      // ---- robust field mapping (backend variations safe) ----
      const pr =
        json?.pending_requirements ??
        json?.pendingReq ??
        json?.state?.pending_requirements ??
        "";

      const sd =
        typeof json?.schema_dirty !== "undefined"
          ? !!json.schema_dirty
          : typeof json?.schemaDirty !== "undefined"
          ? !!json.schemaDirty
          : !!json?.state?.schema_dirty;

      const nsa = (json?.next_suggested_action ||
        json?.nextSuggestedAction ||
        json?.state?.next_suggested_action ||
        "NONE") as NextSuggestedAction;

      onChatUpdate({
        pending_requirements: pr,
        schema_dirty: sd,
        next_suggested_action: nsa,
      });
    } catch (e: any) {
      const msg = (e?.message || String(e)).toString();
      setNetError(msg);
      setMessages((prev) => {
        const next = [
          ...prev,
          {
            role: "assistant" as const,
            content:
              "Architect service is unreachable. Please check your /api/architect route and backend worker.\n" +
              `Error: ${msg}`,
          },
        ];
        return next.slice(-60);
      });
    } finally {
      setBusy(false);
    }
  }

  const send = async () => {
    const trimmed = (input ?? "").trim();
    if (!trimmed || busy) return;

    // history snapshot BEFORE state update
    const historySnapshot = messages;

    console.log("[ArchitectChat] send()", {
        input: trimmed,
        pendingReq_before: pendingReq,
        schemaDirty_before: schemaDirty,
        job_id: currentSchema?.job_id,
      });
      
    setInput("");
    setMessages((prev): ChatMsg[] => {
        const next = [...prev, msg("user", trimmed)];
        return next.slice(-60);
      });
      

    await callChatApi(trimmed, historySnapshot);
  };

  /* =========================
     Render (JSX-level gating ONLY)
  ========================= */

  if (!visible) {
    return null; // safe: AFTER all hooks
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[420px] max-w-[calc(100vw-2rem)]">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xl ring-1 ring-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="text-sm font-semibold">Architect Chat</div>

            {!cvSectionsConfirmed ? (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                Not confirmed
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-100">
                Confirmed
              </span>
            )}

            {schemaDirty && (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                Structure draft
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className={`rounded-lg px-3 py-1 text-sm font-semibold ${BTN_OUTLINE}`}
            >
              {open ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {open && (
          <>
            <div
              ref={scrollRef}
              className="max-h-[420px] overflow-auto px-4 py-3 space-y-2"
            >
              {netError && (
                <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-100">
                  {netError}
                </div>
              )}

              {messages
                .filter((m) => m.role !== "system")
                .map((m, i) => (
                  <div key={i} className={m.role === "user" ? "text-right" : ""}>
                    <div className="inline-block rounded-xl bg-slate-100 px-3 py-2 text-sm whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                  </div>
                ))}
            </div>

            <div className="border-t px-4 py-3">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !(e as any).isComposing) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  disabled={busy}
                  className="flex-1 rounded border px-3 py-2 text-sm disabled:opacity-60"
                  placeholder="Describe the structure change you want…"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={busy}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "…" : "Send"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
