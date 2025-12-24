// web/lib/agent/orchestrator.ts

import type { AgentResult, NextSuggestedAction, AgentContext } from "./contracts";

/**
 * For Phase 1:
 * - behavior must remain identical
 * - only one agent is registered
 */


export type AgentInput = {
  messages?: { role: "system" | "user" | "assistant"; content: string }[];
  context?: AgentContext;
};

export function ruleBasedAgent(args: {
  ctx: AgentInput["context"];
  pickNextSuggestedAction: (ctx: AgentInput["context"]) => NextSuggestedAction;
  buildAssistantMessage: (ctx: AgentInput["context"]) => string;
}): AgentResult {
  const next = args.pickNextSuggestedAction(args.ctx);
  const assistant_message = args.buildAssistantMessage(args.ctx);
  return { assistant_message, next_suggested_action: next };
}

export function orchestrateAgent(args: {
  ctx: AgentInput["context"];
  pickNextSuggestedAction: (ctx: AgentInput["context"]) => NextSuggestedAction;
  buildAssistantMessage: (ctx: AgentInput["context"]) => string;
}): AgentResult {
  // Phase 1: single agent
  return ruleBasedAgent(args);
}
