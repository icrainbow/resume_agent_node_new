// app/api/parse/_shared.ts
// NOTE:
// parseViaWorkerFromForm is intended for RESUME parsing only.
// It calls worker /parse which (a) extracts raw_text and (b) splits into RESUME sections.
// JD parsing should NOT use this helper. JD should extract raw_text only and return jd_text.

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export const runtime = "nodejs";

const WORKER_BASE = process.env.WORKER_BASE_URL || "http://127.0.0.1:8000";

function randId(len = 6) {
  return crypto.randomBytes(len).toString("hex");
}

async function ensureTmpDir() {
  const tmpDir = path.join(process.cwd(), ".tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

type AllowedExt = ".pdf" | ".docx";

function guessResumeExt(fileName: string): AllowedExt | null {
  const lower = (fileName || "").toLowerCase();
  if (lower.endsWith(".pdf")) return ".pdf";
  if (lower.endsWith(".docx")) return ".docx";
  return null;
}

function isJsonFileName(fileName: string) {
  const lower = (fileName || "").toLowerCase();
  return lower.endsWith(".json");
}

function safePreview(s: string, n = 160) {
  return (s || "").slice(0, n).replace(/\s+/g, " ");
}

/**
 * Read + validate JSON schema file (strict):
 * - must be valid JSON object
 * - must contain sections array (since your parsing is schema-driven)
 */
async function readAndValidateSchemaFile(file: File) {
  const text = await file.text();
  try {
    const obj = text ? JSON.parse(text) : null;

    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { ok: false as const, error: "Schema JSON is empty or not an object." };
    }

    // Minimal sanity checks (avoid hard-coding content, but enforce shape)
    const sections = (obj as any).sections;
    if (!Array.isArray(sections) || sections.length === 0) {
      return { ok: false as const, error: "Schema JSON missing required field: sections (non-empty array)." };
    }

    return { ok: true as const, json: obj };
  } catch (e: any) {
    return { ok: false as const, error: `Invalid schema JSON: ${e?.message || "parse error"}` };
  }
}

/**
 * Schema-driven resume parse (STRICT):
 * - resume file is required
 * - schema file is required (field name: "schema")
 * - schema is sent INLINE to worker (no schema_path, no disk persistence for schema)
 */
export async function parseViaWorkerFromForm(
  req: Request,
  formField: string,
  missingMsg: string
) {
  const reqId = crypto.randomUUID().slice(0, 8);
  const t0 = Date.now();

  try {
    const form = await req.formData();

    // -------------------------
    // Required resume file
    // -------------------------
    const f = form.get(formField);

    if (!f || !(f instanceof File)) {
      return NextResponse.json({ ok: false, error: missingMsg }, { status: 400 });
    }

    const ext = guessResumeExt(f.name || "");
    if (!ext) {
      return NextResponse.json(
        { ok: false, error: `Unsupported file type for resume: ${f.name || "(no name)"}` },
        { status: 415 }
      );
    }

    // -------------------------
    // Required schema file (STRICT)
    // Field name (front-end): "schema"
    // -------------------------
    const schemaFile = form.get("schema");
    if (!schemaFile) {
      return NextResponse.json(
        { ok: false, error: "Schema is required. Please upload a .json schema file (field name: schema)." },
        { status: 400 }
      );
    }
    if (!(schemaFile instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Invalid schema upload (expected a file field named: schema)" },
        { status: 400 }
      );
    }

    const schemaName = schemaFile.name || "(no name)";
    if (!isJsonFileName(schemaName)) {
      return NextResponse.json(
        { ok: false, error: `Unsupported file type for schema: ${schemaName}. Please upload a .json file.` },
        { status: 415 }
      );
    }

    const v = await readAndValidateSchemaFile(schemaFile);
    if (!v.ok) {
      return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
    }

    // -------------------------
    // Persist resume to disk (worker reads via file_path)
    // -------------------------
    const tmpDir = await ensureTmpDir();
    const jobId = randId(6);
    const filePath = path.join(tmpDir, `${jobId}${ext}`);

    const buf = Buffer.from(await f.arrayBuffer());
    await fs.writeFile(filePath, buf);

    console.log(`[parse][${reqId}] start`, {
      formField,
      fileName: f.name,
      size: buf.length,
      ext,
      filePath,
      schema: { provided: true, schemaName },
    });

    // -------------------------
    // Call worker (INLINE schema)
    // -------------------------
    const workerPayload: Record<string, any> = {
      file_path: filePath,
      schema: v.json,                 // ✅ inline schema JSON
      schema_name: schemaName,        // ✅ for logging/debug on worker
    };

    const r = await fetch(`${WORKER_BASE}/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workerPayload),
    });

    const raw = await r.text();
    const ms = Date.now() - t0;

    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      // handled below
    }

    if (!r.ok || !data || data.ok !== true) {
      console.error(`[parse][${reqId}] worker failed`, {
        status: r.status,
        ms,
        body_preview: raw.slice(0, 220),
        sent_preview: {
          ...workerPayload,
          schema: "[omitted]", // avoid noisy logs
        },
      });

      return NextResponse.json(
        { ok: false, error: data?.error || "Worker parse failed" },
        { status: 500 }
      );
    }

    console.log(`[parse][${reqId}] done`, {
      ms,
      raw_text_len: (data.raw_text || "").length,
      sections_count: Array.isArray(data.sections) ? data.sections.length : 0,
      sections_ids: Array.isArray(data.sections)
        ? data.sections.map((s: any) => s?.id).filter(Boolean)
        : [],
      raw_text_preview: safePreview(data.raw_text || ""),
    });

    return NextResponse.json({
      ok: true,
      raw_text: data.raw_text || "",
      sections: data.sections || [],
    });
  } catch (e: any) {
    const ms = Date.now() - t0;
    console.error(`[parse][${reqId}] route exception`, { ms, message: e?.message, stack: e?.stack });
    return NextResponse.json(
      { ok: false, error: e?.message || "Parse route error" },
      { status: 500 }
    );
  }
}
