import { NextResponse } from "next/server";

export const runtime = "nodejs";
const WORKER_BASE = process.env.WORKER_BASE_URL || "http://127.0.0.1:8000";
const IS_DEV = process.env.NODE_ENV !== "production";

export async function POST(req: Request) {
  const startTime = Date.now();
  let body: any = null;

  try {
    body = await req.json();
    const job_id = body?.job_id || "unknown";
    const sections_count = Array.isArray(body?.sections) ? body.sections.length : 0;

    if (IS_DEV) {
      console.log(`[api/export] Starting export for job_id=${job_id}, sections=${sections_count}`);
    }

    const r = await fetch(`${WORKER_BASE}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const elapsed_ms = Date.now() - startTime;

    if (IS_DEV) {
      console.log(`[api/export] Worker responded: status=${r.status}, elapsed=${elapsed_ms}ms`);
    }

    const text = await r.text();

    // Parse response to optionally add debug info
    let responseData: any;
    try {
      responseData = JSON.parse(text);
    } catch {
      responseData = { ok: false, error: "Worker returned non-JSON response" };
    }

    // Add debug info in dev mode
    if (IS_DEV && responseData && typeof responseData === "object") {
      responseData.debug = {
        job_id,
        sections_count,
        elapsed_ms,
        worker_status: r.status,
      };
    }

    return NextResponse.json(responseData, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const elapsed_ms = Date.now() - startTime;
    const error = e?.message || String(e);

    if (IS_DEV) {
      console.error(`[api/export] Error after ${elapsed_ms}ms:`, error);
    }

    return NextResponse.json(
      {
        ok: false,
        error,
        ...(IS_DEV && {
          debug: {
            job_id: body?.job_id || "unknown",
            sections_count: Array.isArray(body?.sections) ? body.sections.length : 0,
            elapsed_ms,
            worker_status: 0,
          },
        }),
      },
      { status: 500 }
    );
  }
}

