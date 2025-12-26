/**
 * Azure Blob Naming Conventions
 *
 * Provides helpers for generating consistent blob paths.
 *
 * Path Structure:
 *   users/{owner_user_id}/jobs/{job_id}/{type}/{timestamp}_{filename}
 *
 * Examples:
 *   users/alice/jobs/123e4567-e89b-12d3-a456-426614174000/resume/1735142400000_resume.pdf
 *   users/alice/jobs/123e4567-e89b-12d3-a456-426614174000/exports/1735142400000_tailored-resume.pdf
 *   users/alice/jobs/123e4567-e89b-12d3-a456-426614174000/exports/1735142400000_bundle.zip
 */

export type BlobType = "resume" | "jd" | "schema" | "exports";

/**
 * Build a blob path for the given owner, job, type, and filename.
 *
 * @param ownerUserId - Owner user ID (e.g., "alice")
 * @param jobId - Job UUID
 * @param type - Blob type ("resume", "jd", "schema", "exports")
 * @param filename - Original filename (will be prefixed with timestamp)
 * @returns Blob path (e.g., "users/alice/jobs/{job_id}/exports/1735142400000_resume.pdf")
 */
export function buildBlobPath(
  ownerUserId: string,
  jobId: string,
  type: BlobType,
  filename: string
): string {
  const timestamp = Date.now();
  const sanitizedFilename = sanitizeFilename(filename);
  return `users/${ownerUserId}/jobs/${jobId}/${type}/${timestamp}_${sanitizedFilename}`;
}

/**
 * Build a blob path with custom timestamp (useful for deterministic testing).
 *
 * @param ownerUserId - Owner user ID
 * @param jobId - Job UUID
 * @param type - Blob type
 * @param filename - Original filename
 * @param timestamp - Custom timestamp (milliseconds since epoch)
 * @returns Blob path
 */
export function buildBlobPathWithTimestamp(
  ownerUserId: string,
  jobId: string,
  type: BlobType,
  filename: string,
  timestamp: number
): string {
  const sanitizedFilename = sanitizeFilename(filename);
  return `users/${ownerUserId}/jobs/${jobId}/${type}/${timestamp}_${sanitizedFilename}`;
}

/**
 * Sanitize filename for blob storage.
 * - Replace spaces with underscores
 * - Remove special characters except dots, hyphens, underscores
 * - Limit length to 255 characters
 *
 * @param filename - Original filename
 * @returns Sanitized filename
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .replace(/[^a-zA-Z0-9._-]/g, "") // Remove special characters
    .slice(0, 255); // Limit length
}

/**
 * Parse blob path to extract owner, job, type, and filename.
 *
 * @param blobPath - Full blob path
 * @returns Parsed components or null if invalid format
 */
export function parseBlobPath(blobPath: string): {
  ownerUserId: string;
  jobId: string;
  type: string;
  filename: string;
} | null {
  // Expected format: users/{owner}/jobs/{job_id}/{type}/{timestamp}_{filename}
  const parts = blobPath.split("/");

  if (parts.length < 6 || parts[0] !== "users" || parts[2] !== "jobs") {
    return null;
  }

  const ownerUserId = parts[1];
  const jobId = parts[3];
  const type = parts[4];
  const filenameWithTimestamp = parts.slice(5).join("/"); // Handle filenames with slashes

  // Extract filename (remove timestamp prefix)
  const underscoreIndex = filenameWithTimestamp.indexOf("_");
  const filename =
    underscoreIndex > 0
      ? filenameWithTimestamp.substring(underscoreIndex + 1)
      : filenameWithTimestamp;

  return { ownerUserId, jobId, type, filename };
}
