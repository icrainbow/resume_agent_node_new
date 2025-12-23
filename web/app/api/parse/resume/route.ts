// web/app/api/parse/resume/route.ts
import { NextResponse } from "next/server";
import path from "path";
import os from "os";
import { promises as fs } from "fs";

export const runtime = "nodejs";

const WORKER_BASE = process.env.WORKER_BASE_URL || "http://127.0.0.1:8000";
const WORKER_TIMEOUT_MS = Number(process.env.WORKER_TIMEOUT_MS || "15000"); // 15s default

// --- helpers ---
function safeBaseName(name: string) {
  const base = path.basename(name || "file");
  // keep letters/numbers/._- only
  return base.replace(/[^\w.\-]+/g, "_");
}

async function writeTempFile(file: File, prefix: string) {
  const buf = Buffer.from(await file.arrayBuffer());
  const fname = `${prefix}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}-${safeBaseName(file.name || "upload")}`;
  const abs = path.join(os.tmpdir(), fname);
  await fs.writeFile(abs, buf);
  return abs;
}

async function tryReadJson(res: Response) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

export async function POST(req: Request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);

  try {
    const fd = await req.formData();

    const resume = fd.get("resume");
    const schema = fd.get("schema"); // OPTIONAL now

    if (!(resume instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Missing 'resume' file in form-data." },
        { status: 400 }
      );
    }

    // 1) write resume to temp dir
    const resumePath = await writeTempFile(resume, "resume");

    // 2) schema is optional: if present, write it; if not, fallback on worker side
    let schemaPath: string | null = null;
    let schemaName: string | null = null;

    if (schema instanceof File) {
      schemaPath = await writeTempFile(schema, "schema");
      schemaName = schema.name || "schema.json";
    }

    // 3) call worker /parse
    // - with schema_path if provided
    // - without schema_path => worker should fallback to headline-based splitting
    const payload: any = {
      file_path: resumePath,
    };

    if (schemaPath) {
      payload.schema_path = schemaPath;
      payload.schema_name = schemaName;
    } else {
      payload.fallback = "headline";
    }

    const r = await fetch(`${WORKER_BASE}/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const { text, json } = await tryReadJson(r);

    // If worker returns non-json, keep a readable error
    if (!json) {
      return NextResponse.json(
        {
          ok: false,
          error: `Worker /parse returned non-JSON (HTTP ${r.status}).`,
          details: text?.slice(0, 2000) || "",
        },
        // keep 200 so UI can render; debug panel can show ok=false
        { status: 200 }
      );
    }

    const data = (json || {}) as any;

    // Attach upstream HTTP status for easier debugging (harmless to UI)
    // You can ignore this field on the front-end.
    data._worker_http_status = r.status;

    // Keep contract: worker returns {ok, error, raw_text, sections}
    // Pass-through as 200 so UI can show message and your debug panel captures it
    return NextResponse.json(data, { status: 200 });
  } catch (e: any) {
    const isAbort =
      e?.name === "AbortError" ||
      String(e?.message || "").toLowerCase().includes("aborted");

    return NextResponse.json(
      {
        ok: false,
        error: isAbort
          ? `Worker /parse timed out after ${WORKER_TIMEOUT_MS}ms`
          : e?.message || "Unknown error in /api/parse/resume.",
      },
      { status: 200 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
