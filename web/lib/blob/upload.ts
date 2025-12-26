/**
 * Azure Blob Upload Utilities
 *
 * Provides high-level abstractions for uploading blobs with automatic cleanup on error.
 *
 * Usage:
 *   const result = await uploadBlob(blobPath, buffer, "application/pdf");
 *   // Returns: { blobPath, url, contentLength }
 */

import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { getContainerClient } from "./client";

export interface UploadBlobResult {
  blobPath: string;
  url: string;
  contentLength: number;
}

/**
 * Upload a blob to Azure Blob Storage.
 *
 * @param blobPath - Blob path within the container (e.g., "users/alice/jobs/123/exports/resume.pdf")
 * @param content - Buffer or stream containing the file content
 * @param contentType - MIME type (e.g., "application/pdf", "application/zip")
 * @returns Upload result with blob path and URL
 * @throws Error if upload fails (blob will be cleaned up automatically)
 */
export async function uploadBlob(
  blobPath: string,
  content: Buffer | Readable | ReadableStream,
  contentType: string
): Promise<UploadBlobResult> {
  const containerClient = getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

  // For streams we generally don't know the length upfront.
  // For buffers we know it exactly.
  const knownContentLength = Buffer.isBuffer(content) ? content.length : 0;

  try {
    if (Buffer.isBuffer(content)) {
      // Upload from Buffer
      await blockBlobClient.upload(content, content.length, {
        blobHTTPHeaders: {
          blobContentType: contentType,
        },
      });
    } else {
      // Upload from stream (normalize to Node Readable)
      const nodeStream: Readable =
        content instanceof Readable
          ? content
          : Readable.fromWeb(content as unknown as NodeReadableStream<any>);

      await blockBlobClient.uploadStream(nodeStream, undefined, undefined, {
        blobHTTPHeaders: {
          blobContentType: contentType,
        },
      });
    }

    return {
      blobPath,
      url: blockBlobClient.url,
      contentLength: knownContentLength,
    };
  } catch (error) {
    // Cleanup: attempt to delete partially uploaded blob
    console.error(
      `[BlobUpload] Upload failed for ${blobPath}, attempting cleanup...`,
      error
    );

    try {
      await blockBlobClient.deleteIfExists();
      console.log(`[BlobUpload] Cleanup successful for ${blobPath}`);
    } catch (cleanupError) {
      console.error(`[BlobUpload] Cleanup failed for ${blobPath}:`, cleanupError);
    }

    throw error;
  }
}

/**
 * Upload a blob from a local file path.
 *
 * @param blobPath - Blob path within the container
 * @param localFilePath - Path to local file
 * @param contentType - MIME type
 * @returns Upload result
 */
export async function uploadBlobFromFile(
  blobPath: string,
  localFilePath: string,
  contentType: string
): Promise<UploadBlobResult> {
  const fs = await import("fs");
  const content = fs.readFileSync(localFilePath);
  return uploadBlob(blobPath, content, contentType);
}

/**
 * Delete a blob from Azure Blob Storage.
 *
 * @param blobPath - Blob path to delete
 * @returns True if blob was deleted, false if it didn't exist
 */
export async function deleteBlob(blobPath: string): Promise<boolean> {
  const containerClient = getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

  const response = await blockBlobClient.deleteIfExists();
  return response.succeeded;
}

/**
 * Check if a blob exists.
 *
 * @param blobPath - Blob path to check
 * @returns True if blob exists, false otherwise
 */
export async function blobExists(blobPath: string): Promise<boolean> {
  const containerClient = getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

  return await blockBlobClient.exists();
}

/**
 * Download a blob as a Buffer.
 *
 * @param blobPath - Blob path to download
 * @returns Buffer containing blob content
 */
export async function downloadBlob(blobPath: string): Promise<Buffer> {
  const containerClient = getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

  const downloadResponse = await blockBlobClient.download();

  if (!downloadResponse.readableStreamBody) {
    throw new Error(`Failed to download blob: ${blobPath}`);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of downloadResponse.readableStreamBody) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
