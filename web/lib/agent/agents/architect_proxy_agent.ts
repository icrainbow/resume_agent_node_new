// web/lib/agent/agents/architect_proxy_agent.ts

import type { AgentResult, NextSuggestedAction, AgentContext } from "../contracts";

/**
 * Phase 2: Architect agent stub (safe placeholder).
 * Currently mirrors rule-based logic (no LLM calls, no API calls).
 * In Phase 3, this will integrate with /api/architect for real schema adjustment.
 */
export function architectAgent(args: {
  ctx: AgentContext | undefined;
  pickNextSuggestedAction: (ctx: AgentContext | undefined) => NextSuggestedAction;
  buildAssistantMessage: (ctx: AgentContext | undefined) => string;
}): AgentResult {
  // Phase 2: Delegate to same rule-based logic (100% safe)
  const next = args.pickNextSuggestedAction(args.ctx);
  const assistant_message = args.buildAssistantMessage(args.ctx);

  return {
    assistant_message,
    next_suggested_action: next,
    agent_id_used: "architect",
  };
}
