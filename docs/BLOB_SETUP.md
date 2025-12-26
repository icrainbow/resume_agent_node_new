# Azure Blob Storage Setup Guide

This guide covers setting up Azure Blob Storage for both local development (Azurite) and production (Azure Blob Storage).

## Architecture

### Blob Path Structure

```
users/{owner_user_id}/jobs/{job_id}/{type}/{timestamp}_{filename}
```

**Examples:**
```
users/alice/jobs/123e4567-e89b-12d3-a456-426614174000/resume/1735142400000_resume.pdf
users/alice/jobs/123e4567-e89b-12d3-a456-426614174000/exports/1735142400000_tailored-resume.pdf
users/alice/jobs/123e4567-e89b-12d3-a456-426614174000/exports/1735142400000_bundle.zip
```

### SAS URL Strategy

- **Generated on-demand** (never persisted in database)
- **Read-only permissions**
- **45-minute TTL** (default, configurable)
- **Scoped to individual blob** (not container-wide)

---

## Local Development (Azurite)

Azurite is the Azure Storage emulator for local development.

### Installation

**Option 1: Docker (Recommended)**

```bash
docker run -d \
  --name azurite \
  -p 10000:10000 \
  -p 10001:10001 \
  -p 10002:10002 \
  -v azurite-data:/data \
  mcr.microsoft.com/azure-storage/azurite
```

**Option 2: npm**

```bash
npm install -g azurite
azurite --silent --location /tmp/azurite --debug /tmp/azurite/debug.log
```

### Configuration

Add to `web/.env.local`:

```env
# Azurite (local dev) - primary path
AZURE_STORAGE_CONNECTION_STRING="UseDevelopmentStorage=true"
AZURE_STORAGE_CONTAINER_NAME="resume-exports"
```

For Python worker, add to `worker-py/.env.local`:

```env
AZURE_STORAGE_CONNECTION_STRING="UseDevelopmentStorage=true"
AZURE_STORAGE_CONTAINER_NAME="resume-exports"
```

### Initialize Container

```bash
cd web
set -a; source .env.local; set +a
npx tsx scripts/blob-ensure-container.ts
```

**Expected output:**
```
🔍 Ensuring Azure Blob Storage container exists...

✓ Using connection string (Azurite mode)
✓ Container name: resume-exports

📦 Creating container "resume-exports"...
✅ Container "resume-exports" created successfully.

==================================================
✅ SUCCESS: Container is ready
==================================================
```

### Verify Setup

**Check container exists:**

```bash
# Using Azure Storage Explorer
# OR using curl:
curl http://127.0.0.1:10000/devstoreaccount1/resume-exports?restype=container
```

**Test upload:**

```typescript
import { uploadBlob } from "@/lib/blob/upload";
import { buildBlobPath } from "@/lib/blob/naming";

const blobPath = buildBlobPath("test-user", "test-job-id", "exports", "test.pdf");
const buffer = Buffer.from("Hello, Azurite!");

const result = await uploadBlob(blobPath, buffer, "application/pdf");
console.log(result);
// { blobPath: "...", url: "http://127.0.0.1:10000/...", contentLength: 15 }
```

---

## Production (Azure Blob Storage)

### Prerequisites

1. Azure subscription
2. Storage account created
3. Managed identity enabled for AKS cluster/pods

### Create Storage Account

**Via Azure Portal:**
1. Navigate to "Storage accounts" > "Create"
2. Select subscription and resource group
3. Storage account name: `resumeagentprod` (must be globally unique)
4. Region: Same as AKS cluster
5. Performance: Standard
6. Redundancy: LRS (or GRS for higher durability)
7. Enable "Hierarchical namespace" (optional, for better performance)

**Via Azure CLI:**

```bash
az storage account create \
  --name resumeagentprod \
  --resource-group rg-resume-agent \
  --location eastus \
  --sku Standard_LRS \
  --kind StorageV2
```

### Create Container

```bash
az storage container create \
  --name resume-exports \
  --account-name resumeagentprod \
  --auth-mode login
```

### Configure Managed Identity

**1. Enable managed identity for AKS:**

```bash
az aks update \
  --resource-group rg-resume-agent \
  --name aks-resume-agent \
  --enable-managed-identity
```

**2. Assign Storage Blob Data Contributor role:**

```bash
# Get AKS managed identity principal ID
PRINCIPAL_ID=$(az aks show \
  --resource-group rg-resume-agent \
  --name aks-resume-agent \
  --query identityProfile.kubeletidentity.objectId -o tsv)

# Get storage account ID
STORAGE_ID=$(az storage account show \
  --name resumeagentprod \
  --resource-group rg-resume-agent \
  --query id -o tsv)

# Assign role
az role assignment create \
  --assignee $PRINCIPAL_ID \
  --role "Storage Blob Data Contributor" \
  --scope $STORAGE_ID
```

### Environment Variables (Production)

Add to Kubernetes secrets:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: resume-agent-secrets
type: Opaque
stringData:
  AZURE_STORAGE_ACCOUNT_NAME: "resumeagentprod"
  AZURE_STORAGE_CONTAINER_NAME: "resume-exports"
  # Optional: For SAS URL generation (if not using user delegation SAS)
  AZURE_STORAGE_ACCOUNT_KEY: "<storage-account-key>"
```

**Note:** `AZURE_STORAGE_ACCOUNT_KEY` is only required for SAS URL generation. If using user delegation SAS (recommended), it can be omitted.

### Deploy to AKS

Update Helm values:

```yaml
# values.yaml
env:
  - name: AZURE_STORAGE_ACCOUNT_NAME
    valueFrom:
      secretKeyRef:
        name: resume-agent-secrets
        key: AZURE_STORAGE_ACCOUNT_NAME
  - name: AZURE_STORAGE_CONTAINER_NAME
    valueFrom:
      secretKeyRef:
        name: resume-agent-secrets
        key: AZURE_STORAGE_CONTAINER_NAME
  - name: AZURE_STORAGE_ACCOUNT_KEY
    valueFrom:
      secretKeyRef:
        name: resume-agent-secrets
        key: AZURE_STORAGE_ACCOUNT_KEY
```

---

## Testing

### TypeScript (Web)

```typescript
import { uploadBlob, downloadBlob } from "@/lib/blob/upload";
import { buildBlobPath } from "@/lib/blob/naming";
import { generateSasUrl } from "@/lib/blob/sas";

// Test upload
const blobPath = buildBlobPath("alice", "123", "exports", "test.pdf");
const buffer = Buffer.from("Test content");
const result = await uploadBlob(blobPath, buffer, "application/pdf");

console.log("Uploaded:", result.blobPath);
console.log("URL:", result.url);

// Test SAS URL generation
const sasUrl = await generateSasUrl(blobPath, 45);
console.log("SAS URL:", sasUrl);

// Test download
const downloaded = await downloadBlob(blobPath);
console.log("Downloaded:", downloaded.toString());
```

### Python (Worker)

```python
from src.blob_upload import upload_blob, download_blob, build_blob_path

# Test upload
blob_path = build_blob_path("alice", "123", "exports", "test.pdf")
data = b"Test content"
result = upload_blob(blob_path, data, "application/pdf")

print("Uploaded:", result["blob_path"])
print("URL:", result["url"])

# Test download
downloaded = download_blob(blob_path)
print("Downloaded:", downloaded.decode())
```

---

## Troubleshooting

### Azurite Connection Issues

**Symptom:** `ECONNREFUSED 127.0.0.1:10000`

**Solution:**
1. Ensure Azurite is running: `docker ps | grep azurite`
2. Check connection string in `.env.local`
3. Restart Azurite: `docker restart azurite`

### Container Not Found

**Symptom:** `ContainerNotFound` error

**Solution:**
1. Run container initialization: `npx tsx scripts/blob-ensure-container.ts`
2. Verify container exists via Azure Storage Explorer

### SAS URL Not Working

**Symptom:** SAS URL returns 403 Forbidden

**Solution:**
1. Check account key is set: `AZURE_STORAGE_ACCOUNT_KEY`
2. Verify SAS token expiry time
3. Ensure blob exists before generating SAS URL

### Managed Identity Authentication Fails

**Symptom:** `DefaultAzureCredential failed to retrieve token`

**Solution:**
1. Verify managed identity is enabled for AKS
2. Check role assignment: `az role assignment list --assignee $PRINCIPAL_ID`
3. Ensure pod identity is configured correctly

---

## Security Best Practices

### Local Development
- ✅ Use Azurite connection string (no account keys required)
- ✅ Never commit `.env.local` to git

### Production
- ✅ Use managed identity (preferred over account keys)
- ✅ Store account key in Kubernetes secrets (if needed for SAS)
- ✅ Set container access to "Private" (no anonymous access)
- ✅ Use short-lived SAS URLs (45 minutes default)
- ✅ Generate SAS URLs on-demand (never persist in database)
- ❌ Never expose account keys in logs or error messages
- ❌ Never use connection strings in production

---

## Appendix: File Reference

### TypeScript (Web)

- `web/lib/blob/client.ts` - BlobServiceClient singleton
- `web/lib/blob/sas.ts` - SAS URL generation
- `web/lib/blob/naming.ts` - Blob path helpers
- `web/lib/blob/upload.ts` - Upload/download abstractions
- `web/scripts/blob-ensure-container.ts` - Container initialization

### Python (Worker)

- `worker-py/src/blob_client.py` - BlobServiceClient singleton
- `worker-py/src/blob_upload.py` - Upload/download utilities

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `AZURE_STORAGE_CONNECTION_STRING` | Local dev | Azurite connection string | `UseDevelopmentStorage=true` |
| `AZURE_STORAGE_ACCOUNT_NAME` | Production | Storage account name | `resumeagentprod` |
| `AZURE_STORAGE_ACCOUNT_KEY` | Optional | Account key (for SAS) | `<key>` |
| `AZURE_STORAGE_CONTAINER_NAME` | Optional | Container name | `resume-exports` |

---

**Status:** ✅ PR2 Blob Storage Setup Guide Complete
