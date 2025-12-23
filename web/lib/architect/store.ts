// web/lib/architect/store.ts
import fs from "node:fs/promises";
import path from "node:path";

/**
 * All architect artifacts are stored under:
 *   <project-root>/.architect_store/<jobId>/
 */
const ROOT = path.join(process.cwd(), ".architect_store");

/* =========================
   helpers
========================= */

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

function safeJobId(jobId: string) {
  return String(jobId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

function jobDir(jobId: string) {
  return path.join(ROOT, safeJobId(jobId));
}

function filePath(jobId: string, name: string) {
  return path.join(jobDir(jobId), name);
}

/* =========================
   TEXT (requirements, logs)
========================= */

/**
 * Load a text file. Returns empty string if missing.
 */
export async function loadText(jobId: string, name: string): Promise<string> {
  const p = filePath(jobId, name);
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Overwrite a text file.
 */
export async function saveText(jobId: string, name: string, content: string) {
  const dir = jobDir(jobId);
  await ensureDir(dir);
  await fs.writeFile(filePath(jobId, name), content ?? "", "utf-8");
}

/**
 * Append a line WITH timestamp (audit / intent log).
 * Format: ISO_TS \t content
 */
export async function appendText(
  jobId: string,
  name: string,
  line: string
) {
  const dir = jobDir(jobId);
  await ensureDir(dir);

  const ts = new Date().toISOString();
  const row = `${ts}\t${(line || "").trim()}\n`;
  await fs.appendFile(filePath(jobId, name), row, "utf-8");
}

/**
 * Append raw text WITHOUT timestamp.
 * Intended for LLM consumption (requirements.txt).
 */
export async function appendTextRaw(
  jobId: string,
  name: string,
  line: string
) {
  const dir = jobDir(jobId);
  await ensureDir(dir);

  const row = `${(line || "").trim()}\n`;
  await fs.appendFile(filePath(jobId, name), row, "utf-8");
}

/* =========================
   JSON (schema artifacts)
========================= */

/**
 * Load a JSON file. Returns null if missing or invalid.
 */
export async function loadJson<T = any>(
  jobId: string,
  name: string
): Promise<T | null> {
  const p = filePath(jobId, name);
  try {
    const s = await fs.readFile(p, "utf-8");
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/**
 * Save JSON with pretty format.
 */
export async function saveJson(
  jobId: string,
  name: string,
  obj: any
) {
  const dir = jobDir(jobId);
  await ensureDir(dir);

  await fs.writeFile(
    filePath(jobId, name),
    JSON.stringify(obj ?? null, null, 2),
    "utf-8"
  );
}

/* =========================
   DELETE / RESET
========================= */

export async function deleteFile(jobId: string, name: string) {
  try {
    await fs.unlink(filePath(jobId, name));
  } catch {
    // ignore if missing
  }
}

/**
 * Reset persisted artifacts for a job.
 *
 * Default behavior:
 * - Clear requirements (raw + merged)
 * - Restore current_schema.json from schema_base.json if exists
 * - Keep schema_base.json by default
 */
export async function resetJob(
  jobId: string,
  opts?: { keepSchemaBase?: boolean }
) {
  const keepBase = opts?.keepSchemaBase ?? true;

  // requirements
  await deleteFile(jobId, "requirements.txt");
  await deleteFile(jobId, "requirements_merged.txt");

  // schema
  const base = await loadJson(jobId, "schema_base.json");
  if (base) {
    await saveJson(jobId, "current_schema.json", base);
  } else {
    await deleteFile(jobId, "current_schema.json");
  }

  if (!keepBase) {
    await deleteFile(jobId, "schema_base.json");
  }
}
