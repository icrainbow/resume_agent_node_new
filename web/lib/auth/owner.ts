// web/lib/auth/owner.ts
// Owner resolver abstraction for B2C isolation

/**
 * Get owner_user_id from request context.
 *
 * Phase 5 (current): Stub implementation returns environment variable or header.
 * Phase 6 (TODO): Replace with real authentication (NextAuth, Clerk, etc.)
 *
 * IMPORTANT: All database queries MUST use this resolver and filter by owner_user_id.
 */
export function getOwnerUserId(req: Request): string {
  // Phase 5 stub: Try header first (for testing), fall back to env var
  const headerValue = req.headers.get("X-Owner-User-Id");
  if (headerValue) {
    return headerValue;
  }

  // Default to environment variable (for local dev)
  const envValue = process.env.DEFAULT_OWNER_USER_ID || "dev-user-1";
  return envValue;
}

/**
 * Validate owner_user_id format (basic sanity check).
 * Phase 6: Add real validation (UUID, email, etc.)
 */
export function validateOwnerUserId(owner_user_id: string): boolean {
  if (!owner_user_id || owner_user_id.trim().length === 0) {
    return false;
  }

  // Basic length check (prevent abuse)
  if (owner_user_id.length > 255) {
    return false;
  }

  return true;
}
