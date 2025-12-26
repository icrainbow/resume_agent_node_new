/**
 * Azure Blob SAS URL Generation
 *
 * Generates read-only SAS URLs with configurable TTL (default 45 minutes).
 * SAS URLs are NEVER persisted in the database - generated on-demand only.
 *
 * Usage:
 *   const url = await generateSasUrl("users/alice/jobs/123/exports/resume.pdf");
 *   // Returns: https://account.blob.core.windows.net/resume-exports/users/alice/jobs/123/exports/resume.pdf?sv=...
 */

import {
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";
import { getContainerClient } from "./client";

const DEFAULT_TTL_MINUTES = 45;

/**
 * Generate a read-only SAS URL for the given blob path.
 *
 * @param blobPath - Blob path within the container (e.g., "users/alice/jobs/123/exports/resume.pdf")
 * @param ttlMinutes - Time-to-live in minutes (default: 45)
 * @returns Full SAS URL (https://...)
 *
 * Note: For Azurite (local dev), this uses the development storage account credentials.
 * For production, ensure AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY are set.
 */
export async function generateSasUrl(
  blobPath: string,
  ttlMinutes: number = DEFAULT_TTL_MINUTES
): Promise<string> {
  const containerClient = getContainerClient();
  const blobClient = containerClient.getBlobClient(blobPath);

  // Calculate expiry time
  const startsOn = new Date();
  const expiresOn = new Date(startsOn.getTime() + ttlMinutes * 60 * 1000);

  // Get storage account credentials
  const accountName = getAccountName();
  const accountKey = getAccountKey();

  if (!accountKey) {
    // If no account key available (managed identity mode), return unsigned URL
    // This is a fallback - in production you should use user delegation SAS or service SAS
    console.warn(
      "[SAS] No account key available. Returning unsigned URL. Configure AZURE_STORAGE_ACCOUNT_KEY for SAS support."
    );
    return blobClient.url;
  }

  const credential = new StorageSharedKeyCredential(accountName, accountKey);

  // Generate SAS token with read-only permissions
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: containerClient.containerName,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("r"), // Read-only
      startsOn,
      expiresOn,
    },
    credential
  ).toString();

  // Return full URL with SAS token
  return `${blobClient.url}?${sasToken}`;
}

/**
 * Get storage account name from environment.
 */
function getAccountName(): string {
  // For Azurite
  if (process.env.AZURE_STORAGE_CONNECTION_STRING?.includes("UseDevelopmentStorage=true")) {
    return "devstoreaccount1";
  }

  // For production
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  if (!accountName) {
    throw new Error("Missing AZURE_STORAGE_ACCOUNT_NAME environment variable");
  }

  return accountName;
}

/**
 * Get storage account key from environment.
 */
function getAccountKey(): string | null {
  // For Azurite
  if (process.env.AZURE_STORAGE_CONNECTION_STRING?.includes("UseDevelopmentStorage=true")) {
    return "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
  }

  // For production - return null if not set (managed identity mode)
  return process.env.AZURE_STORAGE_ACCOUNT_KEY || null;
}
