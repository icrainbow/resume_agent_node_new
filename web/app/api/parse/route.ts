import { parseViaWorkerFromForm } from "./_shared";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // Backward-compatible endpoint: still expects "resume"
  return parseViaWorkerFromForm(
    req,
    "resume",
    "Missing resume file (field name: resume)"
  );
}
