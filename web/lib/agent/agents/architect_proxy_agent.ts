// web/lib/agent/agents/architect_proxy_agent.ts

import type { AgentResult, NextSuggestedAction, AgentContext } from "../contracts";

/**
 * Maps /api/architect's string next_suggested_action to NextSuggestedAction type.
 * Observed values: "NONE"
 */
function mapArchitectNSA(x: any): NextSuggestedAction {
  if (x === "NONE") return { kind: "none" };
  // Defensive fallback
  return { kind: "none" };
}

/**
 * Internal helper: safely call /api/architect
 * Returns parsed JSON response or throws
 */
async function callArchitectAPI(
  origin: string,
  payload: { context?: AgentContext }
): Promise<any> {
  console.log("[architect-agent] Calling /api/architect with payload:", JSON.stringify(payload).substring(0, 200));

  const response = await fetch(`${origin}/api/architect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  console.log(`[architect-agent] /api/architect responded with status ${response.status}`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`/api/architect returned ${response.status}: ${text}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(`/api/architect returned non-JSON: ${text.substring(0, 200)}`);
  }

  return await response.json();
}

/**
 * Phase 3: Architect agent with /api/architect integration.
 * Calls /api/architect for schema adjustments.
 * Falls back to rule-based logic on errors (fail-closed).
 */
export async function architectAgent(args: {
  ctx: AgentContext | undefined;
  pickNextSuggestedAction: (ctx: AgentContext | undefined) => NextSuggestedAction;
  buildAssistantMessage: (ctx: AgentContext | undefined) => string;
  origin?: string;
}): Promise<AgentResult> {
  // Fail closed if no origin provided
  if (!args.origin) {
    const next = args.pickNextSuggestedAction(args.ctx);
    const assistant_message = args.buildAssistantMessage(args.ctx);
    return {
      assistant_message,
      next_suggested_action: next,
      agent_id_used: "architect",
      error: "Architect agent requires origin parameter",
    };
  }

  try {
    // Call /api/architect with context
    const payload = { context: args.ctx };
    const result = await callArchitectAPI(args.origin, payload);

    // Check logical success (json.ok === true, NOT HTTP status)
    if (!result.ok) {
      throw new Error(result.error || "Unknown error from /api/architect");
    }

    // Map response to AgentResult
    console.log("[architect-agent] /api/architect succeeded, returning result");

    return {
      assistant_message: result.assistant_message || "Architect agent completed.",
      next_suggested_action: mapArchitectNSA(result.next_suggested_action),
      agent_id_used: "architect",
    };
  } catch (err: any) {
    // Fail closed: return rule-based fallback + error message
    console.error("[architect-agent] Error calling /api/architect:", err.message);

    const next = args.pickNextSuggestedAction(args.ctx);
    const fallbackMessage = args.buildAssistantMessage(args.ctx);

    const errorMsg = err?.message || String(err);
    const assistant_message = `${fallbackMessage}\n\n⚠️ Note: Architect agent encountered an error and returned baseline guidance. Error: ${errorMsg}`;

    return {
      assistant_message,
      next_suggested_action: next,
      agent_id_used: "architect",
      error: `Architect API call failed: ${errorMsg}`,
    };
  }
}
