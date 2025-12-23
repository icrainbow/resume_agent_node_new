// app/api/pdf/[id]/route.ts
import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

function escapeHtml(s: string) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;

    // 基本校验，避免目录穿越
    if (!id || !/^[a-zA-Z0-9]+$/.test(id)) {
      return new NextResponse("Bad preview id", { status: 400 });
    }

    // 读取由 POST /api/pdf 生成的快照
    const fp = path.join(process.cwd(), ".tmp", "pdf-preview", `${id}.json`);
    const raw = await fs.readFile(fp, "utf-8");
    const data = JSON.parse(raw);

    const sections = Array.isArray(data.sections) ? data.sections : [];

    // 拼整份简历 HTML（当前合并状态）
    const bodyHtml = sections
      .map((s: any) => {
        const title = escapeHtml((s.title || "").toString());
        const text = escapeHtml((s.text || "").toString()).replace(/\n/g, "<br/>");
        return `
          <section class="section">
            <div class="title">${title}</div>
            <div class="text">${text}</div>
          </section>
        `;
      })
      .join("\n");

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Resume Preview</title>
  <style>
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont;
      margin: 0;
      background: #f6f7fb;
      color: #0f172a;
    }
    .page {
      max-width: 900px;
      margin: 24px auto;
      background: #fff;
      padding: 28px 34px;
      box-shadow: 0 10px 30px rgba(0,0,0,.08);
      border-radius: 14px;
    }
    .header {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 18px;
    }
    .section {
      margin: 14px 0 18px;
    }
    .title {
      font-weight: 700;
      margin-bottom: 6px;
    }
    .text {
      line-height: 1.55;
      font-size: 14px;
      color: #334155;
    }
    @media print {
      body { background: #fff; }
      .page {
        box-shadow: none;
        margin: 0;
        border-radius: 0;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">Resume Preview</div>
    ${bodyHtml}
  </div>
</body>
</html>`;

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (e: any) {
    return new NextResponse(e?.message || "Preview not found", { status: 404 });
  }
}
