"""
Azure Blob Storage Client for Worker

Supports both Azurite (local dev) and Azure Blob Storage (production).
Uses DefaultAzureCredential for managed identity in production.
Uses connection string for Azurite.

Environment Variables:
- AZURE_STORAGE_ACCOUNT_NAME: Storage account name (production)
- AZURE_STORAGE_CONNECTION_STRING: Connection string (Azurite)
- AZURE_STORAGE_CONTAINER_NAME: Container name (default: "resume-exports")
"""

import os
from azure.storage.blob import BlobServiceClient
from azure.identity import DefaultAzureCredential

_blob_service_client: BlobServiceClient | None = None


def get_blob_service_client() -> BlobServiceClient:
    """
    Get or create BlobServiceClient singleton.

    Local dev (Azurite):
      AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true

    Production (Azure Blob Storage):
      AZURE_STORAGE_ACCOUNT_NAME=myaccount
      Uses DefaultAzureCredential for managed identity.
    """
    global _blob_service_client

    if _blob_service_client:
        return _blob_service_client

    connection_string = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    account_name = os.getenv("AZURE_STORAGE_ACCOUNT_NAME")

    if connection_string:
        # Local dev path (Azurite) - connection string takes precedence
        print("[BlobClient] Using connection string (Azurite mode)")
        _blob_service_client = BlobServiceClient.from_connection_string(connection_string)
    elif account_name:
        # Production path - use managed identity via DefaultAzureCredential
        print(f"[BlobClient] Using managed identity for account: {account_name}")
        credential = DefaultAzureCredential()
        _blob_service_client = BlobServiceClient(
            account_url=f"https://{account_name}.blob.core.windows.net",
            credential=credential,
        )
    else:
        raise ValueError(
            "Missing blob storage configuration. Set either AZURE_STORAGE_CONNECTION_STRING "
            "(Azurite) or AZURE_STORAGE_ACCOUNT_NAME (production)."
        )

    return _blob_service_client


def get_container_name() -> str:
    """Get the container name from environment or use default."""
    return os.getenv("AZURE_STORAGE_CONTAINER_NAME", "resume-exports")


def get_container_client():
    """Get ContainerClient for the configured container."""
    service_client = get_blob_service_client()
    container_name = get_container_name()
    return service_client.get_container_client(container_name)
