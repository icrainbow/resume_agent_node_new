export const dynamic = "force-dynamic";


import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const WORKER_BASE = process.env.WORKER_BASE_URL || "http://127.0.0.1:8000";

/**
 * GET /api/download?job_id=<id>&file=<filename>
 *
 * Proxies download requests to worker's /files endpoint.
 * Validates inputs to prevent path traversal.
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const job_id = searchParams.get("job_id");
    const file = searchParams.get("file");

    // Validate required params
    if (!job_id || !file) {
      return NextResponse.json(
        { ok: false, error: "Missing required parameters: job_id and file" },
        { status: 400 }
      );
    }

    // Validate job_id format (alphanumeric, dash, underscore only)
    if (!/^[a-zA-Z0-9_-]+$/.test(job_id)) {
      return NextResponse.json(
        { ok: false, error: "Invalid job_id format" },
        { status: 400 }
      );
    }

    // Validate file is basename only (no path separators)
    if (file.includes("/") || file.includes("\\")) {
      return NextResponse.json(
        { ok: false, error: "Invalid file: must be basename only" },
        { status: 400 }
      );
    }

    // Validate file extension
    const ext = file.split(".").pop()?.toLowerCase();
    if (!ext || !["pdf", "docx", "md"].includes(ext)) {
      return NextResponse.json(
        { ok: false, error: "Invalid file extension (allowed: pdf, docx, md)" },
        { status: 400 }
      );
    }

    // Proxy to worker /files endpoint
    const workerUrl = `${WORKER_BASE}/files/${encodeURIComponent(job_id)}/${encodeURIComponent(file)}`;

    const response = await fetch(workerUrl, {
      method: "GET",
    });

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { ok: false, error: `File not found: ${job_id}/${file}` },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { ok: false, error: `Worker returned ${response.status}` },
        { status: response.status }
      );
    }

    // Stream response from worker to client
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const contentLength = response.headers.get("content-length");

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${file}"`,
    };

    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }

    // Return streamed bytes
    return new NextResponse(response.body, {
      status: 200,
      headers,
    });
  } catch (e: any) {
    console.error("[api/download] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
