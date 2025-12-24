// web/lib/agent/orchestrator.ts

import type { AgentResult, NextSuggestedAction, AgentContext } from "./contracts";
import { architectAgent } from "./agents/architect_proxy_agent";

/**
 * Phase 2:
 * - Multi-agent infrastructure with registry
 * - Default behavior unchanged (rule agent)
 * - Agent selection explicitly gated
 */

export type AgentInput = {
  messages?: { role: "system" | "user" | "assistant"; content: string }[];
  context?: AgentContext;
};

export type AgentFunction = (args: {
  ctx: AgentInput["context"];
  pickNextSuggestedAction: (ctx: AgentInput["context"]) => NextSuggestedAction;
  buildAssistantMessage: (ctx: AgentInput["context"]) => string;
}) => AgentResult;

export function ruleBasedAgent(args: {
  ctx: AgentInput["context"];
  pickNextSuggestedAction: (ctx: AgentInput["context"]) => NextSuggestedAction;
  buildAssistantMessage: (ctx: AgentInput["context"]) => string;
}): AgentResult {
  const next = args.pickNextSuggestedAction(args.ctx);
  const assistant_message = args.buildAssistantMessage(args.ctx);
  return { assistant_message, next_suggested_action: next };
}

const AGENT_REGISTRY: Record<string, AgentFunction> = {
  rule: ruleBasedAgent,
  architect: architectAgent,
};

function selectAgent(active_agent_id?: string): { agent: AgentFunction; id: string } {
  const id = active_agent_id || "rule";
  const agent = AGENT_REGISTRY[id] || AGENT_REGISTRY["rule"];
  return { agent, id: AGENT_REGISTRY[id] ? id : "rule" };
}

export function orchestrateAgent(args: {
  ctx: AgentInput["context"];
  pickNextSuggestedAction: (ctx: AgentInput["context"]) => NextSuggestedAction;
  buildAssistantMessage: (ctx: AgentInput["context"]) => string;
  active_agent_id?: string;
}): AgentResult {
  const { agent, id } = selectAgent(args.active_agent_id);
  const result = agent({
    ctx: args.ctx,
    pickNextSuggestedAction: args.pickNextSuggestedAction,
    buildAssistantMessage: args.buildAssistantMessage,
  });

  return {
    ...result,
    agent_id_used: id,
  };
}
