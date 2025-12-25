# worker-py/src/app.py
import os
import time
import json
import re
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from src.parsers import parse_docx, parse_pdf
from src.core import ResumeGenerator

from src.utils_sections import (
    render_preview_html,
    split_resume_by_schema,
    split_resume_by_headlines,
    create_word_document_from_markdown,
    create_pdf_from_markdown,
)

load_dotenv()

app = FastAPI(title="Resume Agent Worker", version="0.6-schema-optional-fallback")

from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    print(f"[worker][422][validation] path={request.url.path}")
    try:
        body_bytes = await request.body()
        body_text = body_bytes.decode("utf-8", errors="ignore")
        if len(body_text) > 4000:
            body_text = body_text[:4000] + " ...<truncated>"
        print(f"[worker][422][validation] body={body_text}")
    except Exception as e:
        print(f"[worker][422][validation] body_read_err={repr(e)}")

    try:
        errs = exc.errors()
        print(f"[worker][422][validation] errors={errs}")
    except Exception as e:
        print(f"[worker][422][validation] errors_read_err={repr(e)}")

    return JSONResponse(
        status_code=422,
        content={"ok": False, "error": "Request validation failed", "details": exc.errors()},
    )

_generator: Optional[ResumeGenerator] = None

WORKER_ROOT = Path(__file__).resolve().parents[1]
OUTPUTS_ROOT = WORKER_ROOT / "outputs"
OUTPUTS_ROOT.mkdir(parents=True, exist_ok=True)

app.mount("/files", StaticFiles(directory=str(OUTPUTS_ROOT), html=False), name="files")


def get_generator() -> Optional[ResumeGenerator]:
    global _generator
    if _generator is not None:
        return _generator

    api_key = os.getenv("GEMINI_API_KEY")
    model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    timeout_s = float(os.getenv("GEMINI_TIMEOUT_S", "30"))
    retries = int(os.getenv("GEMINI_RETRIES", "2"))

    if not api_key:
        print("[worker][get_generator] GEMINI_API_KEY not set")
        _generator = None
        return None

    print(
        "[worker][get_generator] init Gemini client "
        f"model={model} timeout_s={timeout_s} retries={retries}"
    )

    _generator = ResumeGenerator(
        api_key=api_key,
        model=model,
        timeout_s=timeout_s,
        max_retries=retries,
    )
    return _generator


# -----------------------------
# Models
# -----------------------------

class Section(BaseModel):
    id: str
    title: str
    text: str
    constraints: Optional[str] = ""

    parentId: Optional[str] = None
    isGroup: bool = False


class ParseReq(BaseModel):
    file_path: str

    cv_schema: Optional[Dict[str, Any]] = Field(
        default=None,
        alias="schema",
        description="Schema JSON object (inline). Optional."
    )

    schema_path: Optional[str] = Field(
        default=None,
        description="Path to schema JSON file on disk (preferred if provided). Optional."
    )

    schema_name: Optional[str] = None

    fallback: Optional[str] = Field(
        default=None,
        description="Optional fallback strategy when schema is not provided. e.g. 'headline'."
    )

    model_config = {"populate_by_name": True}


class ParseDiagnostics(BaseModel):
    """Diagnostic information about parsing results (safe for UI display)"""
    warnings: List[str] = Field(default_factory=list, description="Non-fatal warnings")
    schema_issues: List[str] = Field(default_factory=list, description="Schema contract problems")
    stats: Dict[str, Any] = Field(default_factory=dict, description="Parsing statistics")
    summary: str = Field(default="", description="Short human-readable summary")


class ParseResp(BaseModel):
    ok: bool
    error: Optional[str] = None
    raw_text: str = ""
    sections: List[Section] = Field(default_factory=list)
    diagnostics: Optional[ParseDiagnostics] = None


class OptimizeReq(BaseModel):
    job_id: str
    sections: List[Section]
    jd_text: str = ""
    constraints: Dict[str, Any] = Field(default_factory=dict)
    global_instructions: str = ""


class OptimizedSection(BaseModel):
    id: str
    title: str
    text: str
    optimized_text: str = ""
    warnings: List[str] = Field(default_factory=list)


class OptimizeResp(BaseModel):
    ok: bool
    error: Optional[str] = None
    sections: List[OptimizedSection] = Field(default_factory=list)


class PreviewReq(BaseModel):
    job_id: str
    sections: List[OptimizedSection]


class PreviewResp(BaseModel):
    ok: bool
    error: Optional[str] = None
    html: str = ""


class ExportReq(BaseModel):
    job_id: str
    sections: List[OptimizedSection]
    export_pdf: bool = False
    base_name: Optional[str] = None


class ExportArtifact(BaseModel):
    kind: str  # "pdf" | "docx" | "md"
    filename: str
    url: str


class ExportResp(BaseModel):
    ok: bool
    error: Optional[str] = None
    # Legacy fields (backward compatibility)
    docx_path: Optional[str] = None
    pdf_path: Optional[str] = None
    docx_url: Optional[str] = None
    pdf_url: Optional[str] = None
    # Phase 4: Structured artifacts with Next.js download URLs
    artifacts: Optional[List[ExportArtifact]] = None


# -----------------------------
# Health
# -----------------------------

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/health")
def health():
    return {"ok": True, "worker_file": __file__, "worker_version": "YANRAN-2025-12-24-01"}


# -----------------------------
# Parse helpers
# -----------------------------

def _read_text(path: str) -> str:
    p = (path or "").lower()
    if p.endswith(".docx"):
        return parse_docx(path) or ""
    if p.endswith(".pdf"):
        return parse_pdf(path) or ""
    return ""


def _load_schema_from_path(schema_path: str) -> Dict[str, Any]:
    if not schema_path:
        raise ValueError("schema_path is empty")

    sp = Path(schema_path)
    if not sp.exists():
        raise ValueError(f"schema_path not found: {schema_path}")

    raw = sp.read_text(encoding="utf-8")
    if not raw.strip():
        raise ValueError(f"schema JSON file is empty: {schema_path}")

    try:
        obj = json.loads(raw)
    except Exception as e:
        raise ValueError(f"Invalid schema JSON in file: {schema_path}. Error: {str(e)}")

    if not isinstance(obj, dict) or not obj:
        raise ValueError(f"schema JSON must be a non-empty object: {schema_path}")

    return obj


# -----------------------------
# NEW: schema contract diagnostics (non-invasive)
# -----------------------------

_LOCATOR_KEYS = ("anchor", "anchors", "pattern", "regex", "match", "start", "end", "start_idx", "end_idx")

def _schema_top_summary(schema_obj: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(schema_obj, dict):
        return {"type": str(type(schema_obj))}
    keys = sorted(list(schema_obj.keys()))
    groups = schema_obj.get("groups")
    secs = schema_obj.get("sections")
    return {
        "keys": keys[:40],
        "has_groups": isinstance(groups, list),
        "has_sections": isinstance(secs, list),
        "groups_len": len(groups) if isinstance(groups, list) else None,
        "sections_len": len(secs) if isinstance(secs, list) else None,
    }

def _schema_sections_preview(schema_obj: Dict[str, Any], n: int = 6) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    secs = schema_obj.get("sections")
    if not isinstance(secs, list):
        return out
    for i, s in enumerate(secs[:n]):
        if not isinstance(s, dict):
            out.append({"i": i, "type": str(type(s))})
            continue
        has_locator = any(k in s and s.get(k) not in (None, "", [], {}) for k in _LOCATOR_KEYS)
        out.append({
            "i": i,
            "id": s.get("id"),
            "title": s.get("title"),
            "parentId": s.get("parentId", s.get("parent_id")),
            "isGroup": s.get("isGroup", s.get("is_group")),
            "has_locator": has_locator,
            "locator_keys_present": [k for k in _LOCATOR_KEYS if k in s],
            "keys": sorted(list(s.keys()))[:30],
        })
    return out

def _schema_leaf_locator_stats(schema_obj: Dict[str, Any]) -> Dict[str, Any]:
    """
    Quick signal: do leaf sections contain any locator fields?
    If 0, schema-driven splitter will often return only group stubs.
    """
    secs = schema_obj.get("sections")
    if not isinstance(secs, list):
        return {"sections_type": str(type(secs))}
    leaf = 0
    leaf_with_locator = 0
    leaf_missing_parent = 0
    for s in secs:
        if not isinstance(s, dict):
            continue
        is_group = bool(s.get("isGroup", s.get("is_group", False)))
        if is_group:
            continue
        leaf += 1
        parent = s.get("parentId", s.get("parent_id"))
        if parent in (None, ""):
            leaf_missing_parent += 1
        has_locator = any(k in s and s.get(k) not in (None, "", [], {}) for k in _LOCATOR_KEYS)
        if has_locator:
            leaf_with_locator += 1
    return {
        "leaf_count": leaf,
        "leaf_with_locator": leaf_with_locator,
        "leaf_missing_parent": leaf_missing_parent,
        "locator_keys": list(_LOCATOR_KEYS),
    }


def _extract_schema_anchors(schema_obj: Dict[str, Any]) -> List[str]:
    """
    Extract anchor strings from schema for validation.
    Collects 'start', 'end', 'anchor', 'pattern' from all sections (groups and leaves).
    Returns list of non-empty anchor strings.
    """
    anchors: List[str] = []
    sections = schema_obj.get("sections", [])

    if not isinstance(sections, list):
        return anchors

    for s in sections:
        if not isinstance(s, dict):
            continue

        # Collect various anchor/locator fields
        for field in ("start", "end", "anchor", "pattern", "match"):
            val = s.get(field)
            if val and isinstance(val, str) and val.strip():
                anchors.append(val.strip())

    return anchors


def _check_schema_anchor_match(
    schema_obj: Dict[str, Any],
    raw_text: str,
) -> Dict[str, Any]:
    """
    Check if schema anchors appear in the document.
    Returns dict with:
        - total: number of anchors
        - matched: number of anchors found in raw_text
        - match_ratio: matched/total (0.0 to 1.0)
        - should_fallback: True if match rate too low
        - reason: explanation if should_fallback
    """
    anchors = _extract_schema_anchors(schema_obj)

    if not anchors:
        # No anchors found in schema - can't validate, allow parsing
        return {
            "total": 0,
            "matched": 0,
            "match_ratio": 0.0,
            "should_fallback": False,
            "reason": None,
        }

    # Normalize raw_text for case-insensitive matching
    raw_upper = raw_text.upper()

    matched = 0
    for anchor in anchors:
        # Normalize anchor (strip whitespace, uppercase)
        anchor_normalized = anchor.strip().upper()
        if anchor_normalized and anchor_normalized in raw_upper:
            matched += 1

    total = len(anchors)
    match_ratio = matched / total if total > 0 else 0.0

    # Fallback conditions:
    # 1. If we have at least 2 anchors and NONE matched -> definite mismatch
    # 2. If match ratio < 10% -> likely wrong schema
    should_fallback = False
    reason = None

    if total >= 2 and matched == 0:
        should_fallback = True
        reason = f"Schema has {total} anchors but NONE found in document - schema does not match document structure"
    elif match_ratio < 0.1:
        should_fallback = True
        reason = f"Schema anchor match rate too low: {matched}/{total} ({match_ratio:.1%}) - threshold: 10%"

    return {
        "total": total,
        "matched": matched,
        "match_ratio": match_ratio,
        "should_fallback": should_fallback,
        "reason": reason,
    }


def _build_parse_diagnostics(
    schema_obj: Optional[Dict[str, Any]],
    schema_source: Optional[str],
    sections_normalized: List[Section],
    mode: str,
    raw_text_len: int,
    fallback_reason: Optional[str] = None,
    anchor_stats: Optional[Dict[str, Any]] = None,
) -> ParseDiagnostics:
    """
    Build diagnostics object from parsing results.
    Safe for UI display (no file paths, no secrets).
    """
    warnings: List[str] = []
    schema_issues: List[str] = []

    # Count sections
    total = len(sections_normalized)
    groups = sum(1 for s in sections_normalized if s.isGroup)
    leaves = sum(1 for s in sections_normalized if not s.isGroup)

    # Build stats
    stats: Dict[str, Any] = {
        "total_sections": total,
        "leaf_sections": leaves,
        "group_sections": groups,
        "parsing_mode": mode,
    }

    # Add anchor validation stats if available
    if anchor_stats:
        stats["schema_anchor_total"] = anchor_stats.get("total", 0)
        stats["schema_anchor_matched"] = anchor_stats.get("matched", 0)
        stats["schema_anchor_match_ratio"] = anchor_stats.get("match_ratio", 0.0)

    # Add schema source (safe: just "inline" or filename without path)
    if schema_source:
        if schema_source.startswith("path:"):
            # Extract just filename, not full path
            from pathlib import Path
            try:
                filename = Path(schema_source.replace("path:", "")).name
                stats["schema_source"] = f"file:{filename}"
            except Exception:
                stats["schema_source"] = "file"
        else:
            stats["schema_source"] = schema_source
    elif mode == "fallback_unknown":
        stats["schema_source"] = "none"

    # Build summary based on mode
    if mode == "schema":
        summary = f"Parsed {total} sections ({leaves} leaf, {groups} groups) using schema."
    elif mode == "fallback_unknown":
        if fallback_reason:
            summary = f"Schema fallback: {fallback_reason}. Returned entire document as single UNKNOWN section."
        else:
            summary = f"No schema provided - returned entire document as single UNKNOWN section (1 section, {raw_text_len} chars)."

        if fallback_reason:
            warnings.append("Schema was provided but parsing quality was insufficient")
            schema_issues.append(fallback_reason)
    else:
        summary = f"Parsed {total} sections (mode={mode})."

    return ParseDiagnostics(
        warnings=warnings,
        schema_issues=schema_issues,
        stats=stats,
        summary=summary,
    )


class ExtractReq(BaseModel):
    file_path: str


class ExtractResp(BaseModel):
    ok: bool
    error: Optional[str] = None
    raw_text: str = ""


@app.post("/extract", response_model=ExtractResp)
def extract(req: ExtractReq):
    t0 = time.time()
    try:
        raw = _read_text(req.file_path)
        print("[dbg] raw_head=", raw[:500].replace("\n", "\\n"))
        if not raw.strip():
            return ExtractResp(ok=False, error="extract failed: empty text", raw_text="")
        dt = int((time.time() - t0) * 1000)
        print(f"[worker][/extract] ok raw_len={len(raw)} ms={dt}")
        return ExtractResp(ok=True, raw_text=raw)
    except Exception as e:
        dt = int((time.time() - t0) * 1000)
        print(f"[worker][/extract][ERR] ms={dt} err={repr(e)}")
        return ExtractResp(ok=False, error=str(e), raw_text="")


@app.post("/parse", response_model=ParseResp)
def parse(req: ParseReq):
    """
    Parsing behavior (with fallback_unknown):
    - If NO schema provided -> return ONE section: id="unknown", title="UNKNOWN", text=<full raw text>
    - If schema provided -> schema-driven parsing
    - If schema parsing quality too low -> fallback to UNKNOWN section (parsing_mode="fallback_unknown")
    """
    t0 = time.time()

    try:
        raw = _read_text(req.file_path)
        if not raw.strip():
            diag = ParseDiagnostics(
                warnings=["Document appears to be empty or unreadable"],
                schema_issues=[],
                stats={"total_sections": 0, "leaf_sections": 0, "group_sections": 0, "parsing_mode": "error"},
                summary="Parse failed: empty or unreadable document",
            )
            return ParseResp(ok=False, error="parse failed: empty text", diagnostics=diag)

        schema_obj: Optional[Dict[str, Any]] = None
        schema_source = None

        # IMPORTANT: ParseReq alias uses "schema" but model field is cv_schema
        if isinstance(req.cv_schema, dict) and req.cv_schema:
            schema_obj = req.cv_schema
            schema_source = "inline"
        elif req.schema_path:
            schema_obj = _load_schema_from_path(req.schema_path)
            schema_source = f"path:{req.schema_path}"

        sections_raw: List[Dict[str, Any]] = []
        anchor_stats: Optional[Dict[str, Any]] = None

        if schema_obj is not None:
            schema_name = (req.schema_name or schema_source or "schema").strip()

            # ---- NEW: schema contract diagnostics (pre-split) ----
            print("[worker][/parse][schema] schema_name=", schema_name, "schema_source=", schema_source)
            print("[worker][/parse][schema] schema_top=", _schema_top_summary(schema_obj))
            print("[worker][/parse][schema] leaf_locator_stats=", _schema_leaf_locator_stats(schema_obj))
            prev = _schema_sections_preview(schema_obj, n=8)
            if prev:
                print("[worker][/parse][schema] schema.sections preview (first 8):")
                for row in prev:
                    print("  ", row)

            # ---- ANCHOR VALIDATION: Check if schema matches document ----
            # Schema validity ≠ schema applicability; anchors must appear in document.
            anchor_match = _check_schema_anchor_match(schema_obj, raw)
            print(f"[worker][/parse][ANCHOR_CHECK] total={anchor_match['total']} matched={anchor_match['matched']} ratio={anchor_match['match_ratio']:.1%}")

            if anchor_match["should_fallback"]:
                # Schema anchors not found in document - fallback to UNKNOWN
                # EARLY RETURN to prevent any later code from overwriting sections
                fallback_reason = anchor_match["reason"]
                print(f"[worker][/parse][FALLBACK] {fallback_reason}")

                # Build single UNKNOWN section
                sections = [
                    Section(
                        id="unknown",
                        title="UNKNOWN",
                        text=raw,
                        constraints="",
                        parentId=None,
                        isGroup=False,
                    )
                ]

                # Build diagnostics with anchor stats
                diagnostics = _build_parse_diagnostics(
                    schema_obj=schema_obj,
                    schema_source=schema_source,
                    sections_normalized=sections,
                    mode="fallback_unknown",
                    raw_text_len=len(raw),
                    fallback_reason=fallback_reason,
                    anchor_stats=anchor_match,
                )

                print(f"[worker][/parse][RETURN] parsing_mode=fallback_unknown schema_anchor_total={anchor_match['total']} schema_anchor_matched={anchor_match['matched']} sections=1")
                return ParseResp(ok=True, raw_text=raw, sections=sections, diagnostics=diagnostics)
            else:
                # Schema anchors found - proceed with schema parsing
                print("[worker][/parse] USING FILE:", __file__)
                print("[worker][/parse] about to call split_resume_by_schema, schema_keys=", list(schema_obj.keys())[:20])

                # ---- run splitter ----
                try:
                    sections_raw = split_resume_by_schema(raw, schema_obj)
                except Exception as se:
                    dt = int((time.time() - t0) * 1000)
                    print(f"[worker][/parse][ERR] split_resume_by_schema threw ms={dt} err={repr(se)}")
                    diag = ParseDiagnostics(
                        warnings=["Schema parsing crashed - check schema structure"],
                        schema_issues=[f"Schema splitter error: {str(se)[:200]}"],
                        stats={"total_sections": 0, "leaf_sections": 0, "group_sections": 0, "parsing_mode": "error"},
                        summary=f"Schema parsing crashed: {str(se)[:100]}",
                    )
                    return ParseResp(ok=False, error=f"schema splitter crashed: {str(se)}", raw_text=raw, sections=[], diagnostics=diag)

                print("[dbg] sections_raw_len=", len(sections_raw))
                print(
                    "[dbg] isGroup_count=",
                    sum(1 for s in sections_raw if isinstance(s, dict) and s.get("isGroup")),
                    "leaf_count=",
                    sum(1 for s in sections_raw if isinstance(s, dict) and not s.get("isGroup")),
                )
                print("[dbg] sample=", sections_raw[:3])

                if not sections_raw:
                    diag = ParseDiagnostics(
                        warnings=["Schema parsing produced 0 sections"],
                        schema_issues=["Schema did not match document structure - no sections extracted"],
                        stats={"total_sections": 0, "leaf_sections": 0, "group_sections": 0, "parsing_mode": "error"},
                        summary=f"Schema parsing failed: 0 sections extracted (schema_name={schema_name})",
                    )
                    return ParseResp(
                        ok=False,
                        error=f"schema parsing produced 0 sections (schema_name={schema_name})",
                        raw_text=raw,
                        sections=[],
                        diagnostics=diag,
                    )

                dt = int((time.time() - t0) * 1000)
                print(
                    f"[worker][/parse] ok mode=schema schema_name={schema_name} schema_source={schema_source} "
                    f"sections={len(sections_raw)} ms={dt}"
                )

                # Store anchor stats for diagnostics
                anchor_stats = anchor_match
        else:
            # NO SCHEMA mode: return exactly one UNKNOWN section with full raw text
            print("[worker][/parse] NO SCHEMA PROVIDED - using fallback_unknown mode")
            sections_raw = [
                {
                    "id": "unknown",
                    "title": "UNKNOWN",
                    "text": raw,
                    "isGroup": False,
                }
            ]
            dt = int((time.time() - t0) * 1000)
            print(f"[worker][/parse] ok mode=fallback_unknown (no schema) sections=1 ms={dt}")

        # Normalize to Section model
        sections: List[Section] = []
        for i, s in enumerate(sections_raw):
            if not isinstance(s, dict):
                continue

            sid = str(s.get("id") or f"s{i+1}")
            title = str(s.get("title") or f"Section {i+1}")
            text = str(s.get("text") or "")

            parent_id = s.get("parentId", None)
            if parent_id is not None:
                parent_id = str(parent_id)

            is_group = bool(s.get("isGroup", False))

            sections.append(
                Section(
                    id=sid,
                    title=title,
                    text=text,
                    constraints="",
                    parentId=parent_id,
                    isGroup=is_group,
                )
            )

        dt2 = int((time.time() - t0) * 1000)
        print(f"[worker][/parse] normalized sections={len(sections)} ms={dt2}")

        # ---- VALIDATION: Check parse output quality and apply fallback_unknown if needed ----
        g = sum(1 for s in sections if s.isGroup)
        l = sum(1 for s in sections if not s.isGroup)

        parsing_mode: str
        fallback_reason: Optional[str] = None

        if schema_obj is not None:
            # Schema was provided - validate output quality
            # Rule a) Only groups, no leaf sections
            if g > 0 and l == 0:
                parsing_mode = "fallback_unknown"
                fallback_reason = "Schema produced only group sections with no leaf content"
                print(f"[worker][/parse][FALLBACK] {fallback_reason}")
                sections = [
                    Section(
                        id="unknown",
                        title="UNKNOWN",
                        text=raw,
                        constraints="",
                        parentId=None,
                        isGroup=False,
                    )
                ]
            # Rule b) Leaf sections exist but content quality too low
            elif l > 0:
                # Count non-empty leaf sections
                non_empty_leaves = sum(
                    1 for s in sections
                    if not s.isGroup and (s.text or "").strip()
                )
                non_empty_ratio = non_empty_leaves / l if l > 0 else 0.0

                # Total extracted leaf text length
                total_leaf_text_len = sum(
                    len((s.text or "").strip())
                    for s in sections
                    if not s.isGroup
                )

                # Apply fallback if:
                # - Less than 30% of leaves have non-empty text OR
                # - Total extracted text < 200 chars
                if non_empty_ratio < 0.3:
                    parsing_mode = "fallback_unknown"
                    fallback_reason = f"Schema produced {l} leaf sections but only {non_empty_leaves} ({non_empty_ratio:.1%}) have content (threshold: 30%)"
                    print(f"[worker][/parse][FALLBACK] {fallback_reason}")
                    sections = [
                        Section(
                            id="unknown",
                            title="UNKNOWN",
                            text=raw,
                            constraints="",
                            parentId=None,
                            isGroup=False,
                        )
                    ]
                elif total_leaf_text_len < 200:
                    parsing_mode = "fallback_unknown"
                    fallback_reason = f"Schema extracted only {total_leaf_text_len} chars from {l} leaf sections (threshold: 200 chars)"
                    print(f"[worker][/parse][FALLBACK] {fallback_reason}")
                    sections = [
                        Section(
                            id="unknown",
                            title="UNKNOWN",
                            text=raw,
                            constraints="",
                            parentId=None,
                            isGroup=False,
                        )
                    ]
                else:
                    # Valid schema parsing
                    parsing_mode = "schema"
            else:
                # No groups, no leaves (shouldn't happen, but handle it)
                parsing_mode = "fallback_unknown"
                fallback_reason = "Schema produced no sections"
                print(f"[worker][/parse][FALLBACK] {fallback_reason}")
                sections = [
                    Section(
                        id="unknown",
                        title="UNKNOWN",
                        text=raw,
                        constraints="",
                        parentId=None,
                        isGroup=False,
                    )
                ]
        else:
            # No schema provided
            parsing_mode = "fallback_unknown"

        print(f"[worker][/parse] FINAL parsing_mode={parsing_mode} sections={len(sections)}")

        # Build diagnostics
        diagnostics = _build_parse_diagnostics(
            schema_obj=schema_obj,
            schema_source=schema_source,
            sections_normalized=sections,
            mode=parsing_mode,
            raw_text_len=len(raw),
            fallback_reason=fallback_reason,
            anchor_stats=anchor_stats,
        )

        # Debug log before return
        print(f"[worker][/parse][RETURN] parsing_mode={parsing_mode} schema_anchor_total={diagnostics.stats.get('schema_anchor_total', 'N/A')} schema_anchor_matched={diagnostics.stats.get('schema_anchor_matched', 'N/A')} sections={len(sections)}")

        return ParseResp(ok=True, raw_text=raw, sections=sections, diagnostics=diagnostics)

    except Exception as e:
        dt = int((time.time() - t0) * 1000)
        print(f"[worker][/parse][ERR] ms={dt} err={repr(e)}")
        diag = ParseDiagnostics(
            warnings=["Unexpected error during parsing"],
            schema_issues=[],
            stats={"total_sections": 0, "leaf_sections": 0, "group_sections": 0, "parsing_mode": "error"},
            summary=f"Parse failed with unexpected error: {str(e)[:100]}",
        )
        return ParseResp(ok=False, error=str(e), raw_text="", sections=[], diagnostics=diag)


# -----------------------------
# Optimize
# -----------------------------
@app.post("/optimize", response_model=OptimizeResp)
def optimize(req: OptimizeReq):
    """
    Keep your original optimize() implementation.
    """
    t0 = time.time()

    try:
        generator = get_generator()
        if not req.jd_text.strip():
            return OptimizeResp(ok=False, error="jd_text is empty", sections=[])

        out: List[OptimizedSection] = []
        any_fail = False

        constraints_type = type(req.constraints)
        constraints_keys = (
            list(req.constraints.keys())
            if isinstance(req.constraints, dict)
            else "N/A"
        )

        global_instructions = (req.global_instructions or "").strip()

        print(
            f"[worker][/optimize] start job_id={req.job_id} "
            f"sections={len(req.sections)} jd_len={len(req.jd_text)} "
            f"constraints_type={constraints_type} constraints_keys={constraints_keys} "
            f"global_instructions_len={len(global_instructions)}"
        )

        jd_preview = (req.jd_text or "")[:180].replace("\n", " ")
        gi_preview = (global_instructions or "")[:180].replace("\n", " ")

        for idx, s in enumerate(req.sections):
            st0 = time.time()
            warnings: List[str] = [
                "Please manually verify company names, dates, and numbers."
            ]

            constraints_str = ""
            if isinstance(req.constraints, dict):
                v = req.constraints.get(s.id, "")
                if v is None:
                    constraints_str = ""
                elif isinstance(v, str):
                    constraints_str = v
                else:
                    constraints_str = str(v)

            if not constraints_str and (s.constraints or "").strip():
                constraints_str = (s.constraints or "").strip()

            merged_constraints = constraints_str.strip()
            if global_instructions:
                if merged_constraints:
                    merged_constraints = (
                        f"{global_instructions}\n\n"
                        f"--- Section-specific constraints ---\n"
                        f"{merged_constraints}"
                    )
                else:
                    merged_constraints = global_instructions

            text_preview = (s.text or "")[:180].replace("\n", " ")

            print(
                f"[worker][/optimize] section[{idx}]\n"
                f"  id={s.id}\n"
                f"  title={s.title!r}\n"
                f"  text_len={len(s.text)}\n"
                f"  text_preview={text_preview}\n"
                f"  constraints_len={len(constraints_str)}\n"
                f"  constraints={constraints_str!r}\n"
                f"  global_instructions_len={len(global_instructions)}\n"
                f"  global_instructions_preview={gi_preview}\n"
                f"  merged_constraints_len={len(merged_constraints)}\n"
                f"  jd_len={len(req.jd_text)}\n"
                f"  jd_preview={jd_preview}"
            )

            if generator is None:
                warnings.append("GEMINI_API_KEY not configured; returning original text.")
                out.append(
                    OptimizedSection(
                        id=s.id,
                        title=s.title,
                        text=s.text,
                        optimized_text=s.text,
                        warnings=warnings,
                    )
                )
                continue

            try:
                optimized = generator.optimize_section(
                    title=s.title,
                    original_text=s.text,
                    jd_text=req.jd_text,
                    constraints=merged_constraints,
                )

                optimized = (optimized or "").strip()
                dt = int((time.time() - st0) * 1000)

                out_preview = optimized[:220].replace("\n", " ")

                print(
                    f"[worker][/optimize] section[{idx}] done "
                    f"id={s.id} ms={dt} out_len={len(optimized)} "
                    f"out_preview={out_preview}"
                )

                if not optimized:
                    raise RuntimeError("optimized text is empty after optimize_section()")

                if optimized == (s.text or "").strip():
                    warnings.append("Model returned unchanged content for this section.")

                out.append(
                    OptimizedSection(
                        id=s.id,
                        title=s.title,
                        text=s.text,
                        optimized_text=optimized,
                        warnings=warnings,
                    )
                )

            except Exception as e:
                any_fail = True
                dt = int((time.time() - st0) * 1000)

                print(
                    f"[worker][/optimize][ERR] section[{idx}] "
                    f"id={s.id} ms={dt} err={repr(e)}"
                )

                warnings.append(f"Optimization failed: {str(e)}")
                out.append(
                    OptimizedSection(
                        id=s.id,
                        title=s.title,
                        text=s.text,
                        optimized_text=s.text,
                        warnings=warnings,
                    )
                )

        dt_all = int((time.time() - t0) * 1000)
        print(
            f"[worker][/optimize] done job_id={req.job_id} "
            f"ms={dt_all} any_fail={any_fail}"
        )

        return OptimizeResp(
            ok=True,
            error=None if not any_fail else "Some sections failed",
            sections=out,
        )

    except Exception as e:
        dt_all = int((time.time() - t0) * 1000)
        print(f"[worker][/optimize][FATAL] ms={dt_all} err={repr(e)}")
        return OptimizeResp(ok=False, error=str(e), sections=[])


# -----------------------------
# Preview / Export
# -----------------------------
@app.post("/preview", response_model=PreviewResp)
def preview(req: PreviewReq):
    try:
        html = render_preview_html(req.sections)
        return PreviewResp(ok=True, html=html)
    except Exception as e:
        return PreviewResp(ok=False, error=str(e))


def _build_markdown_from_sections(sections: List[OptimizedSection]) -> str:
    parts: List[str] = []
    for s in sections or []:
        title = (s.title or "").strip()
        body = (s.optimized_text or "").strip() or (s.text or "").strip()
        if not body:
            continue
        if title:
            parts.append(f"## {title}\n\n{body}\n")
        else:
            parts.append(f"{body}\n")
    return "\n".join(parts).strip()


def _sanitize_base_name(name: str) -> str:
    n = (name or "").strip()
    if not n:
        return "Resume"

    n = os.path.basename(n)
    base, _ext = os.path.splitext(n)
    base = base.strip() or "Resume"
    base = re.sub(r"[^\w\-. ]+", "_", base).strip()
    base = re.sub(r"\s+", " ", base).strip()
    return base or "Resume"


def _next_version(out_dir: Path, base: str) -> int:
    if not out_dir.exists():
        return 1

    pat = re.compile(rf"^{re.escape(base)}_v(\d+)\.(docx|pdf)$", flags=re.IGNORECASE)
    mx = 0
    try:
        for fn in os.listdir(out_dir):
            m = pat.match(fn)
            if not m:
                continue
            try:
                v = int(m.group(1))
                if v > mx:
                    mx = v
            except Exception:
                pass
    except FileNotFoundError:
        return 1

    return mx + 1


@app.post("/export", response_model=ExportResp)
def export(req: ExportReq, request: Request):
    try:
        out_dir = OUTPUTS_ROOT / req.job_id
        out_dir.mkdir(parents=True, exist_ok=True)

        base = _sanitize_base_name(req.base_name or "Resume")
        v = _next_version(out_dir, base)

        docx_name = f"{base}_v{v}.docx"
        pdf_name = f"{base}_v{v}.pdf"

        docx_path = out_dir / docx_name
        pdf_path = out_dir / pdf_name

        md = _build_markdown_from_sections(req.sections)

        create_word_document_from_markdown(md, str(docx_path))
        create_pdf_from_markdown(md, str(pdf_path))

        # Legacy URLs (for worker's /files endpoint)
        base_url = str(request.base_url).rstrip("/")
        docx_url = f"{base_url}/files/{req.job_id}/{docx_name}"
        pdf_url = f"{base_url}/files/{req.job_id}/{pdf_name}"

        # Phase 4: Relative URLs for Next.js /api/download proxy
        # Browser will resolve these relative to Next.js origin
        artifacts = [
            ExportArtifact(
                kind="docx",
                filename=docx_name,
                url=f"/api/download?job_id={req.job_id}&file={docx_name}",
            ),
            ExportArtifact(
                kind="pdf",
                filename=pdf_name,
                url=f"/api/download?job_id={req.job_id}&file={pdf_name}",
            ),
        ]

        return ExportResp(
            ok=True,
            docx_path=str(docx_path),
            pdf_path=str(pdf_path),
            docx_url=docx_url,  # Legacy
            pdf_url=pdf_url,  # Legacy
            artifacts=artifacts,  # Phase 4
        )
    except Exception as e:
        return ExportResp(ok=False, error=str(e))
