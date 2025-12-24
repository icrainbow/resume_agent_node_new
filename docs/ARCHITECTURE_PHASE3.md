# ARCHITECTURE.md
## Phase 3 — Real Architect Agent Integration (Completed)

### Overview
This document describes the finalized architecture after Phase 3, where a real Architect Agent is integrated while preserving backward compatibility.

---

## High-Level Flow

Client → POST /api/agent → route.ts  
→ (proxy OR orchestrator)  
→ selected agent → response

---

## Routing Priority

1. proxy_to_architect === true → direct proxy
2. route_hint === "architect" → direct proxy (legacy)
3. route_hint === "architect_agent" → architect agent
4. default → rule agent

---

## Agent System

### Rule Agent
- Default
- Synchronous
- Deterministic
- No network calls

### Architect Agent
- Async
- Calls /api/architect internally
- Fail-closed fallback to rule logic
- Surfaces error without breaking request

---

## Orchestrator

- Async-safe
- Defensive agent registry
- Always returns agent_id_used
- Unknown agents fallback to rule

---

## Contracts

AgentResult:
- assistant_message
- next_suggested_action
- agent_id_used?
- error?

All fields additive and backward compatible.

---

## Guarantees

- Zero breaking changes
- Explicit opt-in for new behavior
- Safe fallback on failure
- Observable execution path

---

## Status

Phase 3 COMPLETE.
