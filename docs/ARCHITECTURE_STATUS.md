# Resume Agent Framework — Architecture & Status

> This document defines the CURRENT STATE of the system, its invariants,
> and the agreed next steps.  
> Any future work (including in new chat windows or by other models)
> MUST respect the constraints defined here.

---

## 1. Project Goal (High-level)

Build a **chat-driven agent framework** for resume parsing, structuring, and optimization, where:

- Chat is the primary interaction surface
- Agents make decisions
- UI actions (Parse / Confirm / Optimize / Manual) are *grounded*, not free-text
- The system can evolve from **single-agent** to **multi-agent orchestration**
  without rewriting UI or UX

---

## 2. What Is DONE and STABLE

### 2.1 Agent Endpoint

- `/api/agent` is the single orchestration endpoint
- Input:
  - `messages[]`
  - `AgentContext` (structured state only, no free-form logic)
- Output:
  - `assistant_message`
  - `next_suggested_action` (typed CTA, single source of truth)
  - `quick_replies` and `ui_action` (derived UI hints)

---

### 2.2 Single Source of Truth (Invariant)

**Business logic lives ONLY in:**

```ts
pickNextSuggestedAction(ctx)
```

- It decides the *primary CTA*
- It does NOT know about UI layout, buttons, or rendering

All UI affordances are derived via:

```ts
buildUiHints(ctx, nextSuggestedAction)
```

> No duplicated decision logic is allowed in frontend or UI components.

---

### 2.3 Safety Invariants (Must Not Break)

The following rules are enforced at BOTH agent and frontend levels:

- `schema_dirty === true`
  - ❌ Optimization is blocked
  - ✅ User is forced to re-confirm sections
- Sections must be confirmed before any optimize action
- UI quick replies cannot bypass these rules

These invariants are **non-negotiable**.

---

### 2.4 Upload Schema Flow

When:

```ts
has_resume === true && sections_count === 0
```

The system must offer BOTH:

- `Parse CV`
- `Upload schema`

Status:

- InputPanel already supports schema upload
- Agent quick replies correctly surface this option
- Schema presence is respected during parsing

---

### 2.5 Frontend–Agent Contract

- Quick replies are **not free text**
- They trigger **UI actions**, not controller logic
- Frontend guards exist to prevent invalid transitions
  (e.g. optimize while schema is dirty)

---

## 3. Current Architecture (As-Is)

### 3.1 Agent Logic

- Rule-based agent lives inside `/api/agent`
- It is deterministic and non-LLM
- It returns:
  - Message
  - CTA
  - UI hints

### 3.2 Frontend

- Chat UI renders:
  - assistant_message
  - quick_replies
- Quick replies map to:
  - Parse
  - Confirm sections
  - Optimize
  - Switch to Manual Mode
- Frontend does NOT decide business logic

---

## 4. Explicit Non-Goals (For Now)

The following are intentionally NOT done yet:

- ❌ Multi-agent orchestration
- ❌ Agent voting / ranking
- ❌ RAG or long-term memory
- ❌ Agent dashboard / observability UI
- ❌ Major UX redesign

These will come later and must not be prematurely introduced.

---

## 5. NEXT PLANNED STEP (Authoritative)

### Phase 1 — Agent Orchestrator Skeleton (NO behavior change)

**Goal:**  
Introduce an agent orchestration abstraction while keeping runtime behavior identical.

**Concrete step:**

- Wrap current rule-based logic into:

```ts
agent(ctx) → AgentResult
```

- Introduce `AgentResult` type:
  - `assistant_message`
  - `next_suggested_action`
- `/api/agent` should call the agent via an orchestrator function
- Only ONE agent is registered at this stage

> This step must:
> - Change minimal code
> - Touch as few files as possible
> - Be fully backward-compatible

---

## 6. Future Roadmap (After Phase 1)

### Phase 2 — Multiple Agents (Still no UI change)

- `ruleBasedAgent`
- `architectAgent` (schema / structure)
- `optimizeAgent`

Routing based on context:
- `schema_dirty === true` → architectAgent
- `confirmed && has_jd` → optimizeAgent

---

### Phase 3 — Agent Cooperation

- Agent chaining (architect → rule → optimize)
- Agent debug trace (non-UI)
- Decision transparency

---

### Phase 4 — Product-Level Features

- Agent dashboard (read-only)
- Decision path visualization
- Optional RAG / persistence

---

## 7. Critical Development Constraints

- One step at a time
- Prefer 1 file per step
- Every step must compile and run
- No large refactors unless explicitly requested
- UX stability > new features

---

## 8. Handoff Instruction (For New Chat Windows)

When continuing this project in a new window or with a new model:

1. Read this document fully
2. Respect the invariants
3. Start from **Phase 1 — Agent Orchestrator Skeleton**
4. Do NOT re-design UX or re-litigate earlier decisions

---

_End of document._
