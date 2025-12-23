// app/api/parse/jd/route.ts
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

type JdExt = ".pdf" | ".docx" | ".txt";

function guessJdExt(fileName: string): JdExt | null {
  const lower = (fileName || "").toLowerCase();
  if (lower.endsWith(".pdf")) return ".pdf";
  if (lower.endsWith(".docx")) return ".docx";
  if (lower.endsWith(".txt")) return ".txt";
  return null;
}

function safePreview(s: string, n = 180) {
  return (s || "").slice(0, n).replace(/\s+/g, " ");
}

export async function POST(req: Request) {
  const reqId = crypto.randomUUID().slice(0, 8);
  const t0 = Date.now();

  try {
    const form = await req.formData();
    const f = form.get("jd");

    if (!f || !(f instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Missing JD file (field name: jd)" },
        { status: 400 }
      );
    }

    const ext = guessJdExt(f.name || "");
    if (!ext) {
      return NextResponse.json(
        { ok: false, error: `Unsupported file type for JD: ${f.name || "(no name)"}` },
        { status: 415 }
      );
    }

    const tmpDir = await ensureTmpDir();
    const jobId = randId(6);
    const filePath = path.join(tmpDir, `${jobId}${ext}`);

    const buf = Buffer.from(await f.arrayBuffer());
    await fs.writeFile(filePath, buf);

    console.log(`[parse-jd][${reqId}] start`, {
      fileName: f.name,
      size: buf.length,
      ext,
      filePath,
    });

    // TXT: do not call worker; return whole text
    if (ext === ".txt") {
      const jd_text = buf.toString("utf-8").trim();

      if (!jd_text) {
        return NextResponse.json(
          { ok: false, error: "JD .txt is empty." },
          { status: 422 }
        );
      }

      const ms = Date.now() - t0;
      console.log(`[parse-jd][${reqId}] done (txt)`, {
        ms,
        jd_text_len: jd_text.length,
        preview: safePreview(jd_text),
      });

      return NextResponse.json({
        ok: true,
        jd_text,
        // optional, for UI reuse
        sections: [{ id: "jd", title: "JD", text: jd_text }],
      });
    }

    // DOCX/PDF: call worker ONLY for raw text extraction.
    // We intentionally do NOT rely on worker "sections" because JD should not be resume-split.
    const r = await fetch(`${WORKER_BASE}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath }),
    });
    

    const raw = await r.text();
    const ms = Date.now() - t0;

    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!r.ok || !data || data.ok !== true) {
      console.error(`[parse-jd][${reqId}] worker failed`, {
        status: r.status,
        ms,
        body_preview: raw.slice(0, 240),
      });

      return NextResponse.json(
        { ok: false, error: data?.error || "Worker parse failed (JD)" },
        { status: 500 }
      );
    }

    const jd_text = (data.raw_text || "").toString().trim();

    if (!jd_text) {
      // Make "empty extraction" explicit (avoid ok/empty)
      console.warn(`[parse-jd][${reqId}] empty raw_text`, {
        ms,
        worker_sections_count: Array.isArray(data.sections) ? data.sections.length : 0,
        worker_sections_ids: Array.isArray(data.sections)
          ? data.sections.map((s: any) => s?.id).filter(Boolean)
          : [],
      });

      return NextResponse.json(
        { ok: false, error: "JD text extraction returned empty content." },
        { status: 422 }
      );
    }

    console.log(`[parse-jd][${reqId}] done`, {
      ms,
      jd_text_len: jd_text.length,
      worker_sections_count: Array.isArray(data.sections) ? data.sections.length : 0,
      preview: safePreview(jd_text),
    });

    return NextResponse.json({
      ok: true,
      jd_text,
      sections: [{ id: "jd", title: "JD", text: jd_text }],
    });
  } catch (e: any) {
    const ms = Date.now() - t0;
    console.error(`[parse-jd][${reqId}] route exception`, {
      ms,
      message: e?.message,
      stack: e?.stack,
    });

    return NextResponse.json(
      { ok: false, error: e?.message || "JD parse route error" },
      { status: 500 }
    );
  }
}
