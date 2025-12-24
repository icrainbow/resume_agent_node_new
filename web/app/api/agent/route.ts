// web/app/api/agent/route.ts
import { NextResponse } from "next/server";
import { orchestrateAgent } from "@/lib/agent/orchestrator";
import type { NextSuggestedAction, AgentContext } from "@/lib/agent/contracts";

export const runtime = "nodejs";

type ChatMsg = {
  role: "system" | "user" | "assistant";
  content: string;
};



type AgentInput = {
  messages?: ChatMsg[];
  context?: AgentContext;

  /**
   * ✅ NEW (optional): passthrough payload for /api/architect if you want.
   * If absent, we forward the entire body as-is.
   */
  architect_payload?: any;
};

type UiAction = {
  key:
    | "upload_resume"
    | "parse_cv"
    | "upload_schema"
    | "confirm_sections"
    | "adjust_structure"
    | "optimize_whole"
    | "switch_to_manual";
  label: string;
};


// =========================
// Phase 1 — Orchestrator Skeleton (NO behavior change)
// Step 1: Introduce AgentResult + single-agent wrapper (NOT wired yet)
// =========================





function pickNextSuggestedAction(
  ctx: AgentContext | undefined
): NextSuggestedAction {
  const hasResume = !!ctx?.has_resume;
  const hasJd = !!ctx?.has_jd;
  const sections = Number(ctx?.sections_count || 0);
  const confirmed = !!ctx?.cv_sections_confirmed;

  if (!hasResume) {
    return {
      kind: "cta",
      id: "upload_resume",
      label: "Upload your resume to begin",
    };
  }

  // has resume, but no sections yet
  // provide both parse_cv and upload_schema
if (sections === 0) {
  return {
    kind: "cta",
    id: "parse_cv",
    label: "Parse resume into sections",
  };
}

  if (!confirmed) {
    return {
      kind: "cta",
      id: "confirm_sections",
      label: "Confirm parsed sections",
    };
  }

  if (!!ctx?.schema_dirty) {
    return {
      kind: "cta",
      id: "confirm_sections",
      label: "Confirm updated section structure",
    };
  }

  if (hasJd) {
    return {
      kind: "cta",
      id: "optimize_whole",
      label: "One-click optimize against JD",
    };
  }

  return { kind: "none" };
}


function buildAssistantMessage(ctx: AgentContext | undefined): string {
  const hasResume = !!ctx?.has_resume;
  const hasSchema = !!ctx?.has_schema;
  const hasJd = !!ctx?.has_jd;
  const sections = Number(ctx?.sections_count || 0);
  const confirmed = !!ctx?.cv_sections_confirmed;
  const schemaDirty = !!ctx?.schema_dirty;

  if (!hasResume) {
    return [
      "I can help you either:",
      "- build a resume from scratch via chat, or",
      "- optimize an existing resume.",
      "",
      "For this MVP, please upload your resume first. Then I will parse it into sections and guide you through confirmation and optimization.",
    ].join("\n");
  }

  if (hasResume && sections === 0) {
    return [
      "Resume detected.",
      "Next step: parse it into structured sections so we can optimize safely and transparently.",
      hasSchema
        ? "Note: a schema file is present; I will validate it during parsing."
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (sections > 0 && !confirmed) {
    return [
      `I extracted ${sections} sections.`,
      "Please review and confirm section boundaries/titles.",
      "If the structure looks wrong, switch to Manual Mode to select sections by highlighting.",
    ].join("\n");
  }

  // ✅ NEW: if schema is dirty, always guide user back to re-confirm structure first
  if (confirmed && schemaDirty) {
    return [
      "A structure draft is in progress (schema_dirty=true).",
      "Please re-confirm the updated section structure before optimizing.",
      "If you want to refine the structure further, describe the changes and use “Adjust structure”.",
    ].join("\n");
  }

  if (confirmed && hasJd) {
    return [
      "Sections are confirmed and a JD is available.",
      "I can run one-click optimization section-by-section. You can still edit constraints per section before running.",
    ].join("\n");
  }

  if (confirmed && !hasJd) {
    return [
      "Sections are confirmed.",
      "Upload a JD or paste JD text to enable targeted optimization (best results).",
    ].join("\n");
  }

  return "Tell me what you want to do next (optimize, restructure, or start from scratch).";
}

function ctaToQuickReplyLabel(a: any): string | null {
  if (!a || a.kind !== "cta") return null;

  const id = String(a.id || "");
  switch (id) {
    case "upload_resume":
      return "Upload resume";
    case "parse_cv":
      return "Parse CV";
    case "upload_schema":
      return "Upload schema";
    case "confirm_sections":
      return "Confirm sections";
    case "optimize_whole":
      return "One-click optimize";
    case "switch_to_manual":
      return "Switch to Manual Mode";
    default:
      return null;
  }
}

function buildUiHints(
  ctx: AgentContext | undefined,
  nsa: NextSuggestedAction
): {
  reply: string;
  quick_replies: string[];
  ui_action: string | null;
} {
  const hasResume = !!ctx?.has_resume;
  const hasJd = !!ctx?.has_jd;
  const hasSchema = !!ctx?.has_schema;
  const schemaDirty = !!ctx?.schema_dirty;
  const sections = Number(ctx?.sections_count || 0);
  const confirmed = !!ctx?.cv_sections_confirmed;

  // Default safe set
  const hints = {
    reply:
      buildAssistantMessage(ctx) +
      (schemaDirty
        ? "\n\nNote: a structure draft is in progress (schema_dirty=true)."
        : ""),
    quick_replies: [] as string[],
    ui_action: null as string | null,
  };

  // ✅ Primary CTA drives quick replies (single source of truth)
  const primary = ctaToQuickReplyLabel(nsa);
  hints.quick_replies = primary ? [primary] : [];

  // ✅ Secondary CTA only when resume exists but has no sections:
  // Keep Parse CV as primary, add Upload schema as extra option.
  if (hasResume && sections === 0) {
    if (!hints.quick_replies.includes("Parse CV")) {
      hints.quick_replies.unshift("Parse CV");
    }
    if (!hints.quick_replies.includes("Upload schema")) {
      hints.quick_replies.push("Upload schema");
    }
    hints.ui_action = "open_tools";
    return hints;
  }

  // For all other branches below, we keep minimal behavior:
  // if you want additional buttons later, we add them explicitly.
  // ✅ When sections are confirmed and JD exists (and schema is NOT dirty),
  // show Optimize + Adjust (per your UX requirement).

  if (confirmed && hasJd && !schemaDirty) {
    hints.quick_replies = ["One-click optimize", "Adjust structure"];
    hints.ui_action = "open_tools";
    return hints;
  }

  if (!confirmed) {
    hints.quick_replies = [
      "Confirm sections",
      "Adjust structure",
      "Switch to Manual Mode",
      "Show diagnostics",
    ];
    hints.ui_action = "open_tools";
    return hints;
  }

  // ✅ NEW: if schema is dirty, do NOT offer optimize; force reconfirm path
  if (confirmed && schemaDirty) {
    hints.quick_replies = [
      "Confirm sections",
      "Adjust structure",
      "Show diagnostics",
      "Switch to Manual Mode",
    ];
    hints.ui_action = "open_tools";
    return hints;
  }

  if (confirmed && hasJd) {
    hints.quick_replies = ["One-click optimize", "Adjust structure"];
    hints.ui_action = "open_tools";
    return hints;
  }

  if (confirmed && !hasJd) {
    hints.quick_replies = [
      "Upload JD",
      "Optimize baseline (no JD)",
      "Adjust structure",
      "Show constraints",
    ];
    hints.ui_action = "open_tools";
    return hints;
  }

  // fallback safe
  hints.quick_replies = ["Show options", "Switch to Manual Mode"];
  hints.ui_action = "open_tools";
  return hints;
}

/**
 * ✅ NEW: Proxy to existing /api/architect route (minimal, transparent).
 * - We mirror status + content-type
 * - We do not assume JSON (architect may return text error)
 */
async function proxyToArchitect(req: Request, body: AgentInput) {
  const origin = new URL(req.url).origin;

  // Prefer explicit architect_payload if provided; otherwise forward original body.
  const payloadToSend =
    typeof body?.architect_payload !== "undefined"
      ? body.architect_payload
      : body;

  const r = await fetch(`${origin}/api/architect`, {
    method: "POST",
    headers: {
      "Content-Type": req.headers.get("content-type") || "application/json",
    },
    body: JSON.stringify(payloadToSend),
    cache: "no-store",
  });

  const text = await r.text();

  return new NextResponse(text, {
    status: r.status,
    headers: {
      "Content-Type": r.headers.get("content-type") || "application/json",
    },
  });
}

export async function POST(req: Request) {
  let body: AgentInput | null = null;

  try {
    body = (await req.json()) as AgentInput;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const ctx = body?.context ?? {};
  const origin = new URL(req.url).origin;

  /**
   * ✅ Routing rule (MINIMAL / NON-SURPRISING):
   * - Only proxy when client explicitly asks: context.proxy_to_architect === true
   * - Keeps your current MVP behavior stable by default.
   *
   * You can later change this to:
   * - route_hint === "architect"
   * - or "auto" heuristics (e.g., if user asks to restructure)
   */
  if (ctx?.proxy_to_architect === true || ctx?.route_hint === "architect") {
    try {
      return await proxyToArchitect(req, body);
    } catch (e: any) {
      const msg = (e?.message || String(e)).toString();
      return NextResponse.json(
        { ok: false, error: `Proxy to /api/architect failed: ${msg}` },
        { status: 502 }
      );
    }
  }

  // ---- Phase 2: NEW agent routing (architect_agent uses architect agent) ----
  if (ctx?.route_hint === "architect_agent") {
    const r = await orchestrateAgent({
      ctx,
      pickNextSuggestedAction,
      buildAssistantMessage,
      active_agent_id: "architect",
      origin,
    });

    const nextSuggestedAction = r.next_suggested_action;
    const assistant_message = r.assistant_message;
    const agent_id_used = r.agent_id_used;
    const error = r.error;

    const ui = buildUiHints(ctx, nextSuggestedAction);

    return NextResponse.json({
      ok: true,
      assistant_message,
      pending_requirements: null,
      schema_dirty: !!ctx?.schema_dirty,
      next_suggested_action: nextSuggestedAction,
      reply: ui.reply,
      quick_replies: ui.quick_replies,
      ui_action: ui.ui_action,
      agent_id_used,
      error,
    });
  }

  // ---- Default: your existing rule-based (non-LLM) MVP agent ----
// ---- Default: your existing rule-based (non-LLM) MVP agent ----
const r = await orchestrateAgent({
  ctx,
  pickNextSuggestedAction,
  buildAssistantMessage,
  origin,
});

const nextSuggestedAction = r.next_suggested_action;
const assistant_message = r.assistant_message;
const agent_id_used = r.agent_id_used;
const error = r.error;

// ✅ Add non-breaking UI hint fields (client may ignore for now)
const ui = buildUiHints(ctx, nextSuggestedAction);

return NextResponse.json({
  ok: true,

  // backward-compatible fields consumed by current ArchitectChat
  assistant_message,
  pending_requirements: null,
  schema_dirty: !!ctx?.schema_dirty,
  next_suggested_action: nextSuggestedAction,

  // forward-compatible fields (safe to ignore)
  reply: ui.reply,
  quick_replies: ui.quick_replies,
  ui_action: ui.ui_action,
  agent_id_used,
  error,
});

}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Use POST /api/agent" },
    { status: 405 }
  );
}
