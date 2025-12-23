import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export const runtime = "nodejs";

async function ensureDir() {
  const dir = path.join(process.cwd(), ".tmp", "pdf-preview");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sections = Array.isArray(body.sections) ? body.sections : null;

    if (!sections || sections.length === 0) {
      return NextResponse.json({ ok: false, error: "sections is empty" }, { status: 400 });
    }

    const normalized = sections.map((s: any) => ({
      id: (s?.id ?? "").toString(),
      title: (s?.title ?? "").toString(),
      text: (s?.text ?? "").toString(),
    }));

    const bad = normalized.some((s: any) => !s.id || !s.title);
    if (bad) {
      return NextResponse.json(
        { ok: false, error: "Invalid section: each section needs id and title" },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const dir = await ensureDir();
    const fp = path.join(dir, `${id}.json`);

    await fs.writeFile(fp, JSON.stringify({ sections: normalized }, null, 2), "utf-8");

    return NextResponse.json({ ok: true, id, url: `/api/pdf/${id}` });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "PDF route error" }, { status: 500 });
  }
}
