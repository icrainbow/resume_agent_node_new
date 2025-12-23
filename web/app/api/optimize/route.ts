// web/app/api/optimize/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

const WORKER_BASE = process.env.WORKER_BASE_URL || "http://127.0.0.1:8000";

function info(reqId: string, msg: string, extra?: any) {
  console.log(`[optimize][${reqId}] ${msg}`, extra ?? "");
}

function err(reqId: string, msg: string, extra?: any) {
  console.error(`[optimize][${reqId}][ERR] ${msg}`, extra ?? "");
}

export async function POST(req: Request) {
  const reqId = crypto.randomUUID().slice(0, 8);
  const t0 = Date.now();

  try {
    const body = await req.json();

    // 兼容：既支持单 section，也支持多 section
    const job_id: string =
      body.job_id || crypto.randomUUID().replace(/-/g, "").slice(0, 12);

    // 新版：sections[] 形态（Whole CV）
    const sections = Array.isArray(body.sections) ? body.sections : null;

    // 旧版：section_id/title/text 单段（仍兼容）
    const section_id: string | undefined = body.section_id;
    const title: string | undefined = body.title;
    const text: string | undefined = body.text;

    const jd_text: string = (body.jd_text || "").toString();
    const constraints: Record<string, any> =
      body.constraints && typeof body.constraints === "object" ? body.constraints : {};

    // ✅ NEW: Whole CV global instructions (notes)
    const global_instructions: string = (body.global_instructions || "").toString();

    if (!jd_text.trim()) {
      return NextResponse.json({ ok: false, error: "jd_text is empty" }, { status: 400 });
    }

    // 统一成 worker 需要的 payload：
    // { job_id, sections: [{id,title,text}], jd_text, constraints, global_instructions }
    let payload: any;

    if (sections && sections.length > 0) {
      // 基本校验，避免 worker 端因为字段缺失直接炸
      const normalized = sections
        .map((s: any) => ({
          id: (s?.id ?? "").toString(),
          title: (s?.title ?? "").toString(),
          text: (s?.text ?? "").toString(),
        }))
        .filter((s: any) => s.id && s.title && s.text);

      if (!normalized.length) {
        return NextResponse.json(
          { ok: false, error: "sections[] provided but invalid (need id/title/text)" },
          { status: 400 }
        );
      }

      payload = {
        job_id,
        sections: normalized,
        jd_text,
        constraints, // 形如 { summary: "...", exp_po: "..." }
        global_instructions, // ✅ NEW
      };

      info(reqId, "POST /api/optimize start (batch)", {
        job_id,
        sections_count: payload.sections.length,
        section_ids: payload.sections.map((s: any) => s.id),
        jd_text_len: jd_text.length,
        constraints_keys: Object.keys(constraints || {}),
        global_instructions_len: global_instructions.length, // ✅ NEW
      });
    } else {
      // 兼容单 section
      if (!section_id || !title || !text) {
        return NextResponse.json(
          { ok: false, error: "Missing sections[] or (section_id,title,text)" },
          { status: 400 }
        );
      }

      payload = {
        job_id,
        sections: [{ id: section_id, title, text }],
        jd_text,
        constraints,
        global_instructions, // ✅ NEW
      };

      info(reqId, "POST /api/optimize start (single->batch)", {
        job_id,
        section_id,
        title,
        text_len: (text || "").length,
        jd_text_len: jd_text.length,
        constraints_keys: Object.keys(constraints || {}),
        global_instructions_len: global_instructions.length, // ✅ NEW
      });
    }

    // 调 worker（Whole CV 可能会久）
    const controller = new AbortController();
    const timeoutMs = Number(process.env.WORKER_OPTIMIZE_TIMEOUT_MS || 120000); // 120s
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let workerJson: any;

    try {
      const w0 = Date.now();
      const workerResp = await fetch(`${WORKER_BASE}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const ms = Date.now() - w0;
      const ct = workerResp.headers.get("content-type") || "";

      const raw = await workerResp.text();
      info(reqId, "Worker /optimize response meta", {
        status: workerResp.status,
        content_type: ct,
        ms,
        body_preview: raw.slice(0, 220),
      });

      workerJson = raw ? JSON.parse(raw) : null;
    } catch (e: any) {
      // Abort / network errors
      const msg =
        e?.name === "AbortError"
          ? `Worker /optimize timed out after ${timeoutMs}ms`
          : e?.message || "Worker /optimize request failed";
      err(reqId, msg, { name: e?.name });
      return NextResponse.json({ ok: false, error: msg }, { status: 504 });
    } finally {
      clearTimeout(timeout);
    }

    if (!workerJson || workerJson.ok !== true) {
      err(reqId, "Worker optimize failed", { workerJson });
      return NextResponse.json(
        { ok: false, error: workerJson?.error || "Worker optimize failed" },
        { status: 500 }
      );
    }

    const workerSections = Array.isArray(workerJson.sections) ? workerJson.sections : [];

    // 不再因为 unchanged 就 hard fail；标 warning
    // optimized_text 为空则回退原文（避免 UI 空白）
    const outSections = workerSections.map((s: any) => {
      const original = (s.text || "").toString();
      const optimized = (s.optimized_text || "").toString();
      const warnings: string[] = Array.isArray(s.warnings) ? s.warnings.slice() : [];

      const finalOptimized = optimized.trim() ? optimized : original;

      if (finalOptimized.trim() === original.trim()) {
        warnings.push("Optimization returned identical content for this section.");
      }

      return {
        id: s.id,
        title: s.title,
        text: original,
        optimized_text: finalOptimized,
        warnings,
      };
    });

    const dt = Date.now() - t0;
    info(reqId, "POST /api/optimize done", {
      job_id,
      sections: outSections.length,
      ms: dt,
    });

    return NextResponse.json({
      ok: true,
      error: workerJson.error || null,
      job_id,
      sections: outSections,
    });
  } catch (e: any) {
    const dt = Date.now() - t0;
    err(reqId, "Unhandled exception in optimize route", {
      message: e?.message,
      stack: e?.stack,
      ms: dt,
    });
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
