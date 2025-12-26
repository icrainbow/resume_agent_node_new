/**
 * Azure Blob Storage Client Singleton
 *
 * Supports both Azurite (local dev) and Azure Blob Storage (production).
 * Uses DefaultAzureCredential for managed identity in production.
 * Uses connection string for Azurite.
 *
 * Environment Variables:
 * - AZURE_STORAGE_ACCOUNT_NAME: Storage account name (production)
 * - AZURE_STORAGE_CONNECTION_STRING: Connection string (Azurite)
 * - AZURE_STORAGE_CONTAINER_NAME: Container name (default: "resume-exports")
 */

import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

let blobServiceClient: BlobServiceClient | null = null;

/**
 * Get or create BlobServiceClient singleton.
 *
 * Local dev (Azurite):
 *   AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true
 *
 * Production (Azure Blob Storage):
 *   AZURE_STORAGE_ACCOUNT_NAME=myaccount
 *   Uses DefaultAzureCredential for managed identity.
 */
export function getBlobServiceClient(): BlobServiceClient {
  if (blobServiceClient) {
    return blobServiceClient;
  }

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;

  if (connectionString) {
    // Local dev path (Azurite) - connection string takes precedence
    console.log("[BlobClient] Using connection string (Azurite mode)");
    blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  } else if (accountName) {
    // Production path - use managed identity via DefaultAzureCredential
    console.log(`[BlobClient] Using managed identity for account: ${accountName}`);
    const credential = new DefaultAzureCredential();
    blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      credential
    );
  } else {
    throw new Error(
      "Missing blob storage configuration. Set either AZURE_STORAGE_CONNECTION_STRING (Azurite) or AZURE_STORAGE_ACCOUNT_NAME (production)."
    );
  }

  return blobServiceClient;
}

/**
 * Get the container name from environment or use default.
 */
export function getContainerName(): string {
  return process.env.AZURE_STORAGE_CONTAINER_NAME || "resume-exports";
}

/**
 * Get ContainerClient for the configured container.
 */
export function getContainerClient() {
  const serviceClient = getBlobServiceClient();
  const containerName = getContainerName();
  return serviceClient.getContainerClient(containerName);
}
