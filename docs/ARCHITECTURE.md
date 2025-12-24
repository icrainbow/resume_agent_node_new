# Resume Agent Architecture Documentation

**Version:** 0.6-schema-optional-fallback  
**Last Updated:** 2024-12-24  
**Purpose:** Persistent project memory for architecture decisions, flows, and file responsibilities

---

## 1. Architecture Overview

### 1.1 Executive Summary

#### What Problem This System Solves

This system solves the problem of CV/resume optimization for job applications.

**Problem:**  
Job seekers need to tailor their resumes to specific job descriptions (JDs), but face challenges:
- Manual editing is time-consuming and inconsistent  
- Difficulty identifying which sections to emphasize or de-emphasize  
- Hard to maintain consistent tone, formatting, and keyword optimization  
- No structured way to apply constraints (e.g., keeping dates accurate, using action verbs)

**Solution:**  
This application provides:
- AI-powered resume parsing with flexible schema support  
- Section-by-section optimization against job descriptions  
- Manual and automatic optimization modes  
- Schema-driven structure validation and adjustment  
- Export to PDF and DOCX with consistent formatting  

#### Who It Is For

- **Primary Users:** Job seekers optimizing resumes for specific job postings  
- **Typical Flow:** Upload CV → Parse → Upload JD → Optimize sections → Export  
- **Skill Level:** Non-technical users, with optional advanced schema and constraint features  

#### What Makes It Non-Trivial

1. **Flexible Schema System**
   - Schema mode (user-provided JSON schema)  
   - No-schema mode (entire document as UNKNOWN)  
   - Fallback mode when schema does not match document  

2. **Anchor Validation**
   - Schema validity is distinct from schema applicability  
   - Anchors extracted and validated against document content  
   - Deterministic fallback thresholds  

3. **Quality-Based Fallback**
   - Pre-parse anchor validation  
   - Post-parse content quality validation  

4. **Schema Adjustment via Chat**
   - Natural-language schema edits via LLM  
   - Sanity validation prevents breaking changes  

5. **Job-Scoped State**
   - All operations scoped to `job_id`  
   - Prevents race conditions and stale responses  

6. **End-to-End Type Safety**
   - TypeScript frontend  
   - Pydantic backend contracts  

---

## 2. High-Level Architecture

### Major Subsystems

```text
Browser UI (Next.js, React, TypeScript)
        ↓ HTTP/JSON
Next.js API Routes
        ↓ HTTP/JSON
FastAPI Worker (Python)
        ↓
Gemini 2.0 (LLM Service)
```

### Subsystem Responsibilities

| Subsystem | Responsibilities | Technologies |
|---------|-----------------|--------------|
| Frontend UI | User interaction, uploads, editing, progress | Next.js, React, Tailwind |
| API Gateway | Validation, file handling, proxying | Next.js API Routes |
| Worker | Parsing, schema validation, AI orchestration, export | FastAPI, Python |
| LLM | Optimization, schema adjustment | Gemini 2.0 |
| Storage | Temp files, outputs | Local filesystem |

---

## 3. End-to-End Flows

### 3.1 CV Parsing (Schema Mode)

**Preconditions:** CV file and schema JSON uploaded.

**Flow Summary:**
1. User clicks **Parse CV**
2. Frontend sends multipart request
3. API validates and stores files
4. Worker extracts text
5. Anchor validation runs
6. Schema-based parsing executes
7. Content quality validation
8. Diagnostics returned
9. UI renders structured sections

**Fallback Conditions:**
- Anchor mismatch  
- Low content quality  
- Invalid schema applicability  

---

### 3.2 CV Parsing (No-Schema / Fallback)

All fallback paths return a single section:

```json
{
  "id": "unknown",
  "title": "UNKNOWN",
  "text": "<full document text>"
}
```

---

## 4. Data Models & Contracts

### Frontend Section Type

```ts
type Section = {
  id: string;
  title: string;
  text: string;
  parentId?: string | null;
  isGroup?: boolean;
  constraints: string;
  optimizedText: string;
};
```

---

## 5. Frontend Architecture

**Key Principles:**
- Single source of truth (controller hook)
- Immutable reducer updates
- Clear separation of UI and logic
- Derived state for gates and flags

---

## 6. Backend / Worker Architecture

**Endpoints:**
- `/parse`
- `/optimize`
- `/preview`
- `/export`

**Pipeline Stages:**
1. Text extraction  
2. Schema loading  
3. Anchor validation  
4. Schema splitting  
5. Quality validation  
6. Diagnostics generation  

---

## 7. Storage & Persistence

- Temporary frontend files: `web/.tmp/`
- Outputs: `worker-py/outputs/{job_id}/`
- Schema store: `web/.architect_store/`
- No automatic cleanup implemented

---

## 8. Observability & Debugging

- Structured worker logs
- Frontend debug panel
- Diagnostics returned with parse responses
- No centralized error tracking

---

## 9. Architectural Risks

1. No authentication (critical)
2. No file cleanup
3. Synchronous LLM calls
4. No persistent database
5. Single-worker limitation

---

## 10. Recommended Next Steps

1. Add authentication and access control  
2. Introduce background job queue  
3. Add database for persistence  

---

## Summary

This document describes the Resume Agent architecture as of version `0.6-schema-optional-fallback`.  
It highlights a flexible schema-based parsing system, strong type safety, and robust diagnostics, while identifying key areas for production hardening.
