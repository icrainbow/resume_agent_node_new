# Resume Agent Architecture — Phase 4

**Version:** Phase 4 (Export Proxy Hardening)
**Last Updated:** 2025-12-25
**Status:** Production-ready multi-agent system with deterministic export

---

## System Overview

```
Browser (Next.js React)
  ↓ HTTP/JSON
Next.js API Routes (Validation, Proxying, Observability)
  ↓ HTTP/JSON
FastAPI Worker (Python - Parsing, Optimization, Export)
  ↓ API calls
Gemini 2.0 Flash (LLM)
```

**Tech Stack:**
- Frontend: Next.js 14, React, TypeScript, Tailwind
- Backend: FastAPI, Python, Pydantic
- LLM: Google Gemini 2.0 Flash
- Storage: Local filesystem (`worker-py/outputs/`)

---

## Core Endpoints & Routing

### Next.js API Routes (web/app/api/)

| Endpoint | Purpose | Proxies To |
|----------|---------|------------|
| `/api/agent` | Agent orchestration (rule/architect selection) | - |
| `/api/architect` | Schema adjustment via LLM | worker `/architect` |
| `/api/parse` | CV parsing | worker `/parse` |
| `/api/optimize` | Section optimization | worker `/optimize` |
| `/api/export` | Export to PDF/DOCX | worker `/export` |
| `/api/download` | File download proxy | worker `/files/{job_id}/{file}` |
| `/api/preview` | HTML preview generation | worker `/preview` |
| `/api/pdf` | Legacy PDF generation | worker `/pdf` |

### Agent Architecture (/api/agent)

**Routing Priority:**
1. `proxy_to_architect === true` → **Direct proxy** to `/api/architect`
2. `route_hint === "architect"` → **Direct proxy** (legacy)
3. `route_hint === "architect_agent"` → **Orchestrator** → architect agent
4. Default → **Orchestrator** → rule agent

**Agents:**
- **Rule Agent** (default): Synchronous, deterministic, no network calls
- **Architect Agent**: Async, calls `/api/architect`, fail-closed fallback

**Orchestrator** (`web/lib/agent/orchestrator.ts`):
- Async-safe agent registry
- Defensive selection (unknown agents → rule agent)
- Always returns `agent_id_used` for observability

**AgentResult Contract:**
```typescript
{
  assistant_message: string;
  next_suggested_action: NextSuggestedAction;
  agent_id_used?: string;
  error?: string;  // Set on fail-closed fallback
}
```

---

## State Management

### AutoMode Controller (`web/app/automode/_hooks/_controller/`)

**Single Source of Truth Pattern:**
- Controller hook manages all state via reducer
- Actions are pure functions receiving state + refs
- Refs prevent stale closures (`sectionsRef`, `jobIdRef`, etc.)

**State Structure:**
```typescript
State {
  // Files
  resumeFile, schemaFile, jdFile, jdText

  // Core data
  sections: Section[]
  jobId: string

  // UI state
  notice, parseBusy, autoOptimizing, exportBusy
  exportLinks: { pdf?, docx?, artifacts? }

  // Gates
  cvSectionsConfirmed: boolean

  // Schema/Chat
  chatVisible, schemaDirty, pendingRequirements
  currentSchema, schemaProvidedByUser
}
```

**Actions:**
- `SET` - Partial state update
- `RESET_ALL` - Clear all state
- `SET_SECTIONS` - Batch update sections with gates

---

## Export Flow (Phase 4 Hardened)

**Architecture:** Browser → Next.js proxy → Worker

```
1. Browser → POST /api/export
2. Next.js validates, proxies to worker /export
3. Worker generates files → outputs/{job_id}/Resume_v{N}.{pdf,docx}
4. Worker returns artifacts with RELATIVE URLs:
   [{ kind: "pdf", filename: "...", url: "/api/download?job_id=...&file=..." }]
5. Browser → GET /api/download (relative URL resolves to Next.js)
6. Next.js validates params, proxies to worker /files/{job_id}/{file}
7. Worker streams file → Next.js → Browser
```

**Security (Download Endpoint):**
- `job_id` must match `/^[a-zA-Z0-9_-]+$/`
- `file` must be basename only (no `/` or `\`)
- File extension whitelist: `.pdf`, `.docx`, `.md`

**Key Improvement (Phase 4):** Worker returns relative URLs instead of guessing Next.js port. Downloads work regardless of Next.js port (3000, 3001, etc.).

---

## Schema Lifecycle

**States:**
1. **No schema** → Parse returns single `UNKNOWN` section
2. **Schema provided** → Anchor validation → Structured parse
3. **Schema dirty** → User requested changes, pending confirmation
4. **Schema confirmed** → Optimize/export enabled

**Gates:**
- `cvSectionsConfirmed`: Required before export/optimize
- `schemaDirty`: Blocks optimize until re-confirmed

**Schema Adjustment Flow:**
1. User chats with architect agent (`route_hint === "architect_agent"`)
2. Agent calls `/api/architect` with context
3. Worker drafts new schema, sets `schema_dirty = true`
4. User confirms → `schema_dirty = false`

---

## Job Scoping

**All operations scoped to `job_id`:**
- Prevents race conditions between concurrent users
- Prevents stale responses from old requests
- Worker stores outputs in `outputs/{job_id}/`

**Job ID Generation:**
- Frontend generates via `ensureJobId()`
- Format: `job-{timestamp}-{random}`
- Persisted in state, synced to `jobIdRef`

---

## Known Constraints & Invariants

### DO NOT BREAK

1. **Default behavior unchanged**: No context flags → rule agent
2. **Legacy proxy preserved**: `proxy_to_architect: true` and `route_hint: "architect"` must still proxy directly
3. **Backward compatibility**: All new fields in response types are optional
4. **Section confirmation gate**: Export/optimize require `cvSectionsConfirmed === true`
5. **Schema dirty blocks optimize**: If `schema_dirty === true`, user must confirm before optimizing
6. **Job ID required**: All worker endpoints require valid `job_id`

### Type Safety

- Frontend: TypeScript strict mode
- Worker: Pydantic models for all requests/responses
- Contracts: Shared types in `web/app/automode/_types/types.ts`

---

## Current Pain Points

### Architecture
- No database - all state ephemeral
- No authentication/authorization
- Single-worker bottleneck (no horizontal scaling)
- Synchronous LLM calls block requests
- No job queue or background processing
- File cleanup not automated

### Developer Experience
- No centralized error tracking
- Limited observability (dev-mode console logs only)
- No metrics/monitoring
- Test coverage minimal
- No CI/CD pipeline

### User Experience
- No progress streaming for long operations
- No retry logic for transient failures
- No file size validation before upload
- Schema validation errors not user-friendly

### Security
- No rate limiting
- No CORS configuration
- Temp files world-readable
- No input sanitization beyond basic validation

---

## What to Improve Next (Architecture-Level)

### Immediate (High Impact, Low Effort)

1. **Add persistent database**
   - Store job state, sections, schema
   - Enable job recovery after server restart
   - Query job history

2. **Implement background job queue**
   - Decouple optimize/export from HTTP request cycle
   - Enable long-running operations without timeout
   - Return job ticket → poll for results

3. **Add authentication layer**
   - User accounts and sessions
   - Job ownership and isolation
   - API key for programmatic access

### Medium-Term (Scalability)

4. **Worker pool with load balancing**
   - Multiple worker instances
   - Health checks and failover
   - Sticky sessions for job affinity

5. **Introduce caching layer**
   - Cache LLM responses for identical inputs
   - Cache parsed CVs for re-optimization
   - TTL-based eviction

6. **Streaming progress updates**
   - WebSocket or SSE for real-time progress
   - Show optimization status per section
   - Export generation progress bar

### Long-Term (Production Hardening)

7. **Observability stack**
   - Structured logging (JSON)
   - Distributed tracing (OpenTelemetry)
   - Metrics dashboard (optimize latency, error rates)
   - Alerting on failures

8. **CI/CD pipeline**
   - Automated tests on PR
   - Smoke tests in staging
   - Blue/green deployments

9. **Schema versioning**
   - Support multiple schema versions
   - Migration path for schema changes
   - Backward compatibility guarantees

---

## File Organization

```
web/
  app/
    api/              # Next.js API routes (proxies)
    automode/         # AutoMode UI + controller
      _hooks/
        _controller/  # State management
          actions/    # Pure action functions
          types.ts    # State/Action contracts
      _types/         # Shared types
  lib/
    agent/            # Agent orchestrator
      agents/         # Individual agents
      contracts.ts    # Agent contracts

worker-py/
  src/
    app.py            # FastAPI endpoints
    core.py           # LLM integration
    parsers.py        # CV parsing logic
    utils_sections.py # Export generation
  outputs/            # Generated files
```

---

## Decision Log (Key Choices)

### Phase 1-2: Agent Infrastructure
- **Choice:** Separate orchestrator from routing
- **Rationale:** Explicit agent selection vs implicit routing
- **Trade-off:** More code, clearer execution path

### Phase 3: Architect Agent
- **Choice:** Fail-closed fallback instead of throwing errors
- **Rationale:** Preserve user experience on LLM failures
- **Trade-off:** Silent degradation vs visible errors

### Phase 4: Export Proxy
- **Choice:** Relative URLs + Next.js proxy vs direct worker URLs
- **Rationale:** Eliminate port coupling, work across environments
- **Trade-off:** Extra network hop vs deterministic behavior

---

## Testing Strategy

### Current

- Manual testing via UI
- Smoke test script: `scripts/smoke_export.sh`
- TypeScript compilation check: `npx tsc --noEmit`

### Needed

- Unit tests for agents/orchestrator
- Integration tests for API routes
- E2E tests for complete flows
- Load testing for worker endpoints
- Schema validation regression tests

---

## Handoff Checklist

**To understand this codebase:**

1. Read `docs/ARCHITECTURE.md` (base system, parsing flow)
2. Read `docs/ARCHITECTURE_PHASE3.md` (agent system)
3. Read this doc (current state, Phase 4 export)
4. Explore `web/app/automode/_hooks/_controller/` (state management)
5. Explore `web/lib/agent/` (agent orchestrator)
6. Review `worker-py/src/app.py` (worker endpoints)

**Before making changes:**

- Check "DO NOT BREAK" constraints above
- Run `npx tsc --noEmit` to verify types
- Test both AutoMode and Manual Mode flows
- Verify export downloads work end-to-end
- Run `bash scripts/smoke_export.sh` if touching export

**Common pitfalls:**

- Forgetting to sync `sectionsRef.current` with state
- Breaking schema_dirty gate logic
- Changing default agent selection behavior
- Adding required fields to existing response types
- Not preserving backward compatibility in contracts
