# worker-py/src/core.py
# Gemini REST API (v1beta) — enhanced creativity & rewrite enforcement

from __future__ import annotations

import os
import time
from typing import Optional

import httpx


class ResumeGenerator:
    """
    Optimizes ONE resume section (string in -> string out).

    Guarantees:
    - Uses a Gemini model that actually exists (prefer env GEMINI_MODEL)
    - Per-request HARD timeout via httpx
    - Retries with exponential backoff
    - Strong prompt enforcement to avoid unchanged output
    """

    # NOTE:
    # Keep DEFAULT_MODEL as a fallback only.
    # Your .env should define GEMINI_MODEL=gemini-2.0-flash (or equivalent),
    # so env will win.
    DEFAULT_MODEL = "gemini-2.0-flash"

    def __init__(
        self,
        api_key: str,
        model: str | None = None,
        timeout_s: float = 30.0,
        max_retries: int = 2,
    ):
        if not api_key:
            raise ValueError("GEMINI_API_KEY is required")

        self.api_key = api_key

        # Prefer explicit arg > env > fallback
        env_model = os.getenv("GEMINI_MODEL", "").strip()
        self.model = (model or env_model or self.DEFAULT_MODEL).strip()

        self.timeout_s = timeout_s
        self.max_retries = max_retries

        # Tunables (do NOT remove; controlled via env)
        # Lower temperature is safer for resume factuality.
        # You can still override in .env if you want more "rewrite aggression".
        try:
            self.temperature = float(os.getenv("GEMINI_TEMPERATURE", "0.35"))
        except Exception:
            self.temperature = 0.35

        # Avoid truncation for longer sections
        try:
            self.max_output_tokens = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "1536"))
        except Exception:
            self.max_output_tokens = 1536

        # Optional: if you want to strictly enforce rewrite attempts.
        # If set to "0"/"false", unchanged content will be accepted immediately.
        enforce_env = os.getenv("GEMINI_SAFETY_REWRITE_ENFORCE", "1").strip().lower()
        self.enforce_rewrite = enforce_env not in ("0", "false", "no", "off")

        self.endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent"
        )

        self.client = httpx.Client(
            timeout=httpx.Timeout(timeout_s),
        )

        print(
            f"[core][init] Gemini model={self.model} "
            f"timeout_s={timeout_s} retries={max_retries} "
            f"temperature={self.temperature} max_output_tokens={self.max_output_tokens} "
            f"enforce_rewrite={self.enforce_rewrite}"
        )

    # ---------------------------------------------------------
    # Public API
    # ---------------------------------------------------------
    def optimize_section(
        self,
        title: str,
        original_text: str,
        jd_text: str,
        constraints: str = "",
    ) -> str:
        title = (title or "").strip()
        original_text = (original_text or "").strip()
        jd_text = (jd_text or "").strip()
        constraints = (constraints or "").strip()

        if not original_text:
            raise ValueError("original_text is empty")
        if not jd_text:
            raise ValueError("jd_text is empty")

        prompt = self._build_prompt(
            title=title,
            original_text=original_text,
            jd_text=jd_text,
            constraints=constraints,
        )

        # ---- DEBUG: prompt visibility ----
        print(
            "[core][prompt]\n"
            f"  title={title!r}\n"
            f"  constraints_len={len(constraints)}\n"
            f"  prompt_len={len(prompt)}\n"
            f"  prompt_preview={prompt[:400].replace(chr(10), ' ')}"
        )

        last_err: Optional[Exception] = None
        last_out: str = ""

        for attempt in range(self.max_retries + 1):
            t0 = time.time()
            try:
                resp = self.client.post(
                    self.endpoint,
                    params={"key": self.api_key},
                    json={
                        "contents": [
                            {
                                "role": "user",
                                "parts": [{"text": prompt}],
                            }
                        ],
                        "generationConfig": {
                            # Safer by default (resume factuality & tone)
                            "temperature": self.temperature,
                            # Reduce truncation risk
                            "maxOutputTokens": self.max_output_tokens,
                        },
                    },
                )

                dt = int((time.time() - t0) * 1000)

                if resp.status_code != 200:
                    raise RuntimeError(
                        f"Gemini HTTP {resp.status_code}: {resp.text[:300]}"
                    )

                data = resp.json()

                print(
                    "[core][response]\n"
                    f"  attempt={attempt} ms={dt}\n"
                    f"  keys={list(data.keys())}\n"
                    f"  candidates_count={len(data.get('candidates', []))}"
                )

                out = self._extract_text(data)
                out = (out or "").strip()
                last_out = out

                print(
                    f"[core][optimize_section] attempt={attempt} "
                    f"out_len={len(out)} "
                    f"out_preview={out[:200].replace(chr(10), ' ')}"
                )

                if not out:
                    raise RuntimeError("Gemini returned empty content")

                # ---- Rewrite enforcement (safer) ----
                # Old behavior: if unchanged -> raise (can push model to "change for change's sake")
                # New behavior:
                # - If enforce_rewrite disabled: accept out immediately
                # - If enforce_rewrite enabled:
                #     - attempt 0: unchanged -> retry once (or up to max_retries)
                #     - last attempt: unchanged -> ACCEPT and let upper layers warn / user review
                # This avoids "inventing" under pressure.
                if self.enforce_rewrite and out.strip() == original_text.strip():
                    if attempt < self.max_retries:
                        raise RuntimeError("Gemini returned unchanged content (retrying)")
                    else:
                        print(
                            "[core][optimize_section][WARN] "
                            "Gemini still returned unchanged content after retries; accepting as-is."
                        )
                        return out

                return out

            except Exception as e:
                last_err = e
                dt = int((time.time() - t0) * 1000)
                print(
                    f"[core][optimize_section][ERR] attempt={attempt} "
                    f"ms={dt} err={repr(e)}"
                )

                if attempt < self.max_retries:
                    sleep_s = 1.5 * (2 ** attempt)
                    print(f"[core][optimize_section] retrying in {sleep_s:.1f}s …")
                    time.sleep(sleep_s)
                else:
                    break

        # If we got some output but errors afterwards, return last_out only if you want "best effort".
        # Keep your prior strictness: raise on failure.
        # (We keep this conservative; upstream app.py already has fallback behavior.)
        raise RuntimeError(f"optimize_section failed after retries: {last_err}")

    # ---------------------------------------------------------
    # Helpers
    # ---------------------------------------------------------
    def _extract_text(self, data: dict) -> str:
        """
        Correct and safe Gemini response parsing.
        """
        try:
            candidates = data.get("candidates") or []
            if not candidates:
                return ""

            parts = candidates[0].get("content", {}).get("parts", [])
            texts = [
                p.get("text", "").strip()
                for p in parts
                if isinstance(p, dict) and isinstance(p.get("text"), str)
            ]

            return "\n".join(t for t in texts if t).strip()
        except Exception as e:
            print(f"[core][_extract_text][ERR] {repr(e)}")
            return ""

    def _build_prompt(
        self,
        title: str,
        original_text: str,
        jd_text: str,
        constraints: str,
    ) -> str:
        constraints_block = (
            f"\nUser constraints (must follow strictly):\n{constraints}\n"
            if constraints
            else ""
        )

        return f"""
Task:
Rewrite ONLY the resume section below to strongly match the job description.

CRITICAL RULES (DO NOT IGNORE):
- Do NOT simply return the original text.
- If the output is very similar to the original, it is considered a FAILURE.
- Aggressively integrate relevant keywords, responsibilities, and signals from the job description.
- You may restructure sentences, reorder ideas, and change phrasing substantially.
- Output ONLY the optimized section text.
- No headings, no markdown, no quotes.
- Keep all facts accurate; do NOT invent companies, dates, or metrics.
- Follow user constraints strictly unless they violate factual accuracy.

Section title:
{title}
{constraints_block}

Original resume section:
{original_text}

Job description:
{jd_text}
""".strip()
