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

  // OPTIONAL context
  context?: {
    has_resume?: boolean;
    has_schema?: boolean;
    has_jd?: boolean;
    sections_count?: number;
    cv_sections_confirmed?: boolean;
    schema_dirty?: boolean;
  };

  // Dock support
  presentation?: "floating" | "dock";
  dockHeight?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onRequestExpand?: () => void;
};

const CHAT_API = "/api/agent";

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

// 🧩 NEW: structured UI actions from /api/agent
type UiAction = {
  key: string; // e.g. "parse_cv"
  label?: string; // display text
};

export default function ArchitectChat(props: ArchitectChatProps) {
  const {
    currentSchema,
    visible,
    cvSectionsConfirmed,
    schemaDirty,
    pendingReq,
    context,
    onConfirm: _onConfirm,
    onAdjust: _onAdjust,
    onChatUpdate,
    presentation = "floating",
    dockHeight,
    collapsed,
    onToggleCollapse,
    onRequestExpand,
  } = props;

  /* =========================
     State & refs
  ========================= */

  const [open, setOpen] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [input, setInput] = useState<string>("");
  const [netError, setNetError] = useState<string>("");

  // quick replies from /api/agent (optional)
  const [quickReplies, setQuickReplies] = useState<string[]>([]);

  // 🧩 NEW: structured actions from /api/agent (optional)
  const [uiActions, setUiActions] = useState<UiAction[]>([]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const clearHoverTimer = () => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearHoverTimer();
    };
  }, []);

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
  }, [
    messages,
    visible,
    netError,
    collapsed,
    presentation,
    dockHeight,
    quickReplies,
    uiActions,
  ]);

  /* =========================
     Welcome seeding
  ========================= */

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
  }, [currentSchema?.job_id, schemaContext.sections_outline, welcomeText]);

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

  function pickAssistantText(json: any): string {
    const t = (json?.reply ?? json?.assistant_message ?? json?.message ?? "").toString();
    return t.trim();
  }

  function pickQuickReplies(json: any): string[] {
    const arr = json?.quick_replies;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x: any) => typeof x === "string" && x.trim().length > 0);
  }

  // 🧩 NEW: parse structured CTA actions (optional)
  function pickUiActions(json: any): UiAction[] {
    const arr = json?.actions;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x: any) => typeof x?.key === "string" && x.key.trim().length > 0);
  }

  function findButtonByText(textNeedles: string[]): HTMLButtonElement | null {
    try {
      const needles = (textNeedles || [])
        .map((s) => String(s || "").trim().toLowerCase())
        .filter(Boolean);
      if (!needles.length) return null;

      const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
      for (const b of btns) {
        const t = (b?.innerText || b?.textContent || "").trim().toLowerCase();
        if (!t) continue;
        if (needles.some((n) => t.includes(n))) return b;
      }
      return null;
    } catch {
      return null;
    }
  }

  function clickUi(selectorCandidates: string[], textNeedles: string[]): boolean {
    try {
      for (const sel of selectorCandidates || []) {
        if (!sel) continue;
        const el = document.querySelector(sel) as any;
        if (el && typeof el.click === "function") {
          el.click();
          return true;
        }
      }
    } catch {
      // ignore
    }

    const b = findButtonByText(textNeedles);
    if (b && typeof (b as any).click === "function") {
      try {
        (b as any).click();
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  // ✅ apply quick reply as a UI action (best-effort). Returns true if handled.
  function applyQuickReplyAction(label: string): boolean {
    const raw = (label || "").trim();
    if (!raw) return false;

    const t = raw.toLowerCase();

    /**
     * 🚨 HARD SAFETY GUARD
     * If schema is dirty, NEVER allow optimize.
     * Force user back to "Confirm Sections" instead.
     *
     * This is a frontend safety net in case agent logic or quick replies misfire.
     */
    if (schemaDirty && (t.includes("optimize") || t.includes("one-click"))) {
      return clickUi(
        [
          "[data-testid='btn-confirm-sections']",
          "[data-testid='confirm-sections']",
          "[data-action='confirm-sections']",
        ],
        ["confirm cv sections", "confirm sections", "confirm"]
      );
    }

    // 🔒 Explicit UI action aliases (highest priority)
    const ACTION_MAP: Record<string, () => boolean> = {
      "parse cv": () =>
        clickUi(
          [
            "[data-testid='btn-parse-cv']",
            "[data-testid='parse-cv']",
            "[data-action='parse-cv']",
          ],
          ["parse cv", "parse resume", "parse"]
        ),

      "confirm sections": () =>
        clickUi(
          [
            "[data-testid='btn-confirm-sections']",
            "[data-testid='confirm-sections']",
            "[data-action='confirm-sections']",
          ],
          ["confirm cv sections", "confirm sections", "confirm"]
        ),

      "one-click optimize": () =>
        clickUi(
          [
            "[data-testid='btn-optimize-whole']",
            "[data-testid='optimize-whole']",
            "[data-action='optimize-whole']",
          ],
          ["one-click optimize", "optimize whole", "optimize"]
        ),

      "adjust structure": () =>
        clickUi(
          [
            "[data-testid='btn-adjust-structure']",
            "[data-testid='adjust-structure']",
            "[data-action='adjust-structure']",
          ],
          ["adjust structure", "adjust"]
        ),

      "upload schema": () =>
        clickUi(
          [
            // ✅ prefer the clickable label/button
            "[data-testid='btn-upload-schema']",
            // ✅ fallback: explicit input (some browsers allow click to open picker)
            "#schema-upload",
            "[data-testid='upload-schema']",
            // ✅ last resort
            "[data-action='upload-schema']",
          ],
          ["upload schema", "upload cv schema", "schema"]
        ),

    };

    const key = raw.toLowerCase();
    if (ACTION_MAP[key]) return ACTION_MAP[key]();

    // Manual mode routing (best-effort)
    if (t.includes("manual")) {
      try {
        window.location.href = "/manualmode";
        return true;
      } catch {
        return false;
      }
    }

    // Adjust structure
    if (t.includes("adjust") && t.includes("structure")) {
      return clickUi(
        [
          "[data-testid='btn-adjust-structure']",
          "[data-testid='adjust-structure']",
          "[data-action='adjust-structure']",
        ],
        ["adjust structure", "adjust"]
      );
    }

    // Upload schema (kept once; removed duplicate branch)
    if (t.includes("upload") && t.includes("schema")) {
      return clickUi(
        [
          "[data-testid='btn-upload-schema']",
          "[data-testid='upload-schema']",
          "[data-action='upload-schema']",
          "input[type='file'][name='schema']",
          "input[type='file'][accept*='json']",
        ],
        ["upload schema", "upload section schema", "schema"]
      );
    }

    // Parse CV
    if (t.includes("parse")) {
      return clickUi(
        [
          "[data-testid='btn-parse-cv']",
          "[data-testid='parse-cv']",
          "[data-action='parse-cv']",
        ],
        ["parse cv", "parse resume", "parse"]
      );
    }

    // Confirm sections
    if (t.includes("confirm")) {
      return clickUi(
        [
          "[data-testid='btn-confirm-sections']",
          "[data-testid='confirm-sections']",
          "[data-action='confirm-sections']",
        ],
        ["confirm cv sections", "confirm sections", "confirm"]
      );
    }

    // Optimize whole (only reachable when schemaDirty === false)
    if (t.includes("optimize") || t.includes("one-click")) {
      return clickUi(
        [
          "[data-testid='btn-optimize-whole']",
          "[data-testid='optimize-whole']",
          "[data-action='optimize-whole']",
        ],
        ["one-click optimize", "optimize whole", "optimize"]
      );
    }

    return false;
  }

  // centralized click handler (UI action first, fallback to send text)
  const handleQuickReplyClick = async (q: string) => {
    if (busy) return;

    const handled = applyQuickReplyAction(q);

    if (handled) {
      setMessages((prev): ChatMsg[] => {
        const next = [...prev, msg("assistant", `OK — triggering: ${q}`)];
        return next.slice(-60);
      });
      return;
    }

    await send(q);
  };

  // 🧩 NEW: render helper: actions first, fallback quickReplies
  const renderActionsOrQuickReplies = (opts?: {
    limit?: number;
    compact?: boolean;
    stopPropagation?: boolean;
  }) => {
    const limit = opts?.limit;
    const compact = !!opts?.compact;
    const stopPropagation = !!opts?.stopPropagation;

    const items: Array<{ label: string }> =
      uiActions && uiActions.length > 0
        ? uiActions.map((a) => ({ label: a.label || a.key }))
        : quickReplies.map((q) => ({ label: q }));

    const shown = typeof limit === "number" ? items.slice(0, limit) : items;

    if (!shown.length) return null;

    return (
      <div className={compact ? "mt-2 flex flex-wrap gap-2" : "mt-3 flex flex-wrap gap-2"}>
        {shown.map((it, i) => (
          <button
            key={`${it.label}-${i}`}
            type="button"
            disabled={busy}
            onClick={(e) => {
              if (stopPropagation) e.stopPropagation();
              handleQuickReplyClick(it.label);
            }}
            className={
              compact
                ? `rounded-lg px-3 py-1 text-[11px] font-semibold ${BTN_OUTLINE} disabled:opacity-50`
                : `rounded-lg px-3 py-1.5 text-xs font-semibold ${BTN_OUTLINE} disabled:opacity-50`
            }
            title={it.label}
          >
            {it.label}
          </button>
        ))}
      </div>
    );
  };

  async function callChatApi(userText: string, historySnapshot: ChatMsg[]) {
    const text = (userText ?? "").trim();
    if (!text) return;

    if (busy) return;
    setBusy(true);
    setNetError("");

    const convo = (historySnapshot || []).filter((m) => m.role !== "system");
    const pendingReqStr = normalizePendingReq(pendingReq);

    const agentContext = {
      ...(context || {}),
      has_schema:
        typeof context?.has_schema === "boolean" ? context.has_schema : !!currentSchema,
      sections_count:
        typeof context?.sections_count === "number"
          ? context.sections_count
          : Array.isArray(currentSchema?.sections)
          ? currentSchema.sections.length
          : 0,
      cv_sections_confirmed:
        typeof context?.cv_sections_confirmed === "boolean"
          ? context.cv_sections_confirmed
          : !!cvSectionsConfirmed,
      schema_dirty:
        typeof context?.schema_dirty === "boolean" ? context.schema_dirty : !!schemaDirty,
    };

    const agentMessages: ChatMsg[] = [
      msg("system", systemPrompt),
      msg(
        "system",
        `Context:\n${safeStringify(
          {
            ...schemaContext,
            schema_dirty: !!schemaDirty,
            pending_requirements_len: pendingReqStr.length,
            cv_sections_confirmed: !!cvSectionsConfirmed,
          },
          2
        )}`
      ),
      ...convo,
      msg("user", text),
    ];

    const payload = {
      messages: agentMessages,
      context: agentContext,
      action: "chat" as const,
      ts: nowIso(),
      current: {
        job_id: currentSchema?.job_id ?? "",
        jd_text: currentSchema?.jd_text ?? "",
        sections: Array.isArray(currentSchema?.sections) ? currentSchema.sections : [],
      },
      state: {
        pending_requirements: pendingReqStr,
        schema_dirty: !!schemaDirty,
      },
    };

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
        const msgText = (json?.error || json?.message || raw || `HTTP ${r.status}`)
          .toString();
        setNetError(msgText);
        setQuickReplies([]);
        setUiActions([]); // 🧩 NEW: clear on error
        setMessages((prev) => {
          const next = [
            ...prev,
            {
              role: "assistant" as const,
              content: "Agent service returned an error.\n" + `Error: ${msgText}`,
            },
          ];
          return next.slice(-60);
        });
        return;
      }

      const assistantText = pickAssistantText(json);
      if (assistantText) {
        setMessages((prev): ChatMsg[] => {
          const next = [...prev, msg("assistant", assistantText)];
          return next.slice(-60);
        });
      }

      setQuickReplies(pickQuickReplies(json));
      setUiActions(pickUiActions(json)); // 🧩 NEW: actions

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
      const msgText = (e?.message || String(e)).toString();
      setNetError(msgText);
      setQuickReplies([]);
      setUiActions([]); // 🧩 NEW: clear on exception
      setMessages((prev) => {
        const next = [
          ...prev,
          {
            role: "assistant" as const,
            content: "Agent service is unreachable.\n" + `Error: ${msgText}`,
          },
        ];
        return next.slice(-60);
      });
    } finally {
      setBusy(false);
    }
  }

  const send = async (overrideText?: string) => {
    const trimmed = ((overrideText ?? input) ?? "").trim();
    if (!trimmed || busy) return;

    const historySnapshot = messages;

    // only clear textbox when it was from textbox
    if (typeof overrideText === "undefined") setInput("");

    setMessages((prev): ChatMsg[] => {
      const next = [...prev, msg("user", trimmed)];
      return next.slice(-60);
    });

    await callChatApi(trimmed, historySnapshot);

    // ✅ CHANGE (minimal): remove auto-minimize after each send.
    // Previously:
    // if (presentation === "dock" && !collapsed) onToggleCollapse?.();
  };

  /* =========================
     Render (NO visible gate)
  ========================= */

  if (presentation === "dock") {
    const nonSystem = messages.filter((m) => m.role !== "system");
    const lastAssistant = [...nonSystem]
      .reverse()
      .find((m) => m.role === "assistant");
    const lastUser = [...nonSystem].reverse().find((m) => m.role === "user");

    const summaryText = (lastAssistant?.content || lastUser?.content || "").trim();
    const summaryLines = summaryText
      ? summaryText.split("\n").slice(0, 4).join("\n")
      : "Tell me how to split / adjust the sections…";

    const isCollapsed = typeof collapsed === "boolean" ? collapsed : true;

    const scheduleHoverExpand = () => {
      if (!isCollapsed) return;
      if (!onRequestExpand) return;
      if (busy) return;
      clearHoverTimer();
      hoverTimerRef.current = window.setTimeout(() => {
        onRequestExpand?.();
        hoverTimerRef.current = null;
      }, 350);
    };

    const cancelHoverExpand = () => {
      clearHoverTimer();
    };

    return (
      <div className="w-full">
        {!isCollapsed ? (
          <div className="px-4 py-3">
            {netError ? (
              <div className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-100">
                {netError}
              </div>
            ) : null}

            <div
              ref={scrollRef}
              className="max-h-[260px] overflow-auto space-y-2 pr-1"
              onClick={() => onRequestExpand?.()}
            >
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

            {/* actions first; fallback quickReplies */}
            {renderActionsOrQuickReplies()}
          </div>
        ) : (
          <div
            className="px-4 py-3 cursor-pointer select-none"
            onMouseEnter={scheduleHoverExpand}
            onMouseLeave={cancelHoverExpand}
            onFocus={scheduleHoverExpand}
            onBlur={cancelHoverExpand}
            onClick={() => onRequestExpand?.()}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                <span className="font-semibold text-slate-800">
                  Parsed the CV. Summary:
                </span>
                {"\n"}
                {summaryLines}
              </div>

              <div className="shrink-0 pt-0.5">
                <div className="rounded-lg bg-white/70 px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                  Hover to expand ↑
                </div>
              </div>
            </div>

            {/* actions first; fallback quickReplies (limit to 3, compact) */}
            {renderActionsOrQuickReplies({ limit: 3, compact: true, stopPropagation: true })}
          </div>
        )}

        <div className="border-t px-4 py-3 bg-white">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => onRequestExpand?.()}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !(e as any).isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={busy}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-60"
              placeholder="Tell me how to split / adjust the sections…"
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={busy}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              title={busy ? "Working…" : "Send"}
            >
              {busy ? "…" : "Send"}
            </button>
          </div>

          {onToggleCollapse ? (
            <div className="mt-2 text-right">
              <button
                type="button"
                onClick={onToggleCollapse}
                className={`rounded-lg px-3 py-1 text-xs font-semibold ${BTN_OUTLINE}`}
              >
                {isCollapsed ? "Expand" : "Minimize"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // floating mode
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[420px] max-w-[calc(100vw-2rem)]">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xl ring-1 ring-slate-200">
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

              {/* actions first; fallback quickReplies (floating) */}
              {renderActionsOrQuickReplies()}
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
                  onClick={() => send()}
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
