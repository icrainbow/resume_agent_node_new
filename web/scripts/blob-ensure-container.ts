#!/usr/bin/env node
/**
 * Ensure Azure Blob Storage Container Exists
 *
 * Creates the container if it doesn't exist. Idempotent - safe to run multiple times.
 *
 * Usage:
 *   set -a; source .env.local; set +a; npx tsx scripts/blob-ensure-container.ts
 */

import { getBlobServiceClient, getContainerName } from "@/lib/blob/client";

async function main() {
  console.log("🔍 Ensuring Azure Blob Storage container exists...\n");

  // Check required environment variables
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;

  if (!connectionString && !accountName) {
    console.error("❌ FAIL: Missing blob storage configuration.");
    console.error("Set either:");
    console.error("  - AZURE_STORAGE_CONNECTION_STRING (for Azurite)");
    console.error("  - AZURE_STORAGE_ACCOUNT_NAME (for production)");
    process.exit(1);
  }

  if (connectionString) {
    console.log("✓ Using connection string (Azurite mode)");
  } else {
    console.log(`✓ Using managed identity for account: ${accountName}`);
  }

  const containerName = getContainerName();
  console.log(`✓ Container name: ${containerName}\n`);

  try {
    const serviceClient = getBlobServiceClient();
    const containerClient = serviceClient.getContainerClient(containerName);

    // Check if container exists
    const exists = await containerClient.exists();

    if (exists) {
      console.log(`✅ Container "${containerName}" already exists.`);
    } else {
      console.log(`📦 Creating container "${containerName}"...`);

      // Create container with private access (default: no anonymous access)
      await containerClient.create();

      console.log(`✅ Container "${containerName}" created successfully.`);
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ SUCCESS: Container is ready");
    console.log("=".repeat(50));
  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);
    if (error.code) {
      console.error("Error code:", error.code);
    }
    if (error.statusCode) {
      console.error("Status code:", error.statusCode);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ FATAL:", error.message);
  process.exit(1);
});
