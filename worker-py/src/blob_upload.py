"""
Azure Blob Upload Utilities for Worker

Provides high-level abstractions for uploading blobs with automatic cleanup on error.

Usage:
    result = upload_blob(blob_path, data, "application/pdf")
    # Returns: {"blob_path": "...", "url": "...", "content_length": 123}
"""

from typing import BinaryIO
from azure.storage.blob import ContentSettings
from .blob_client import get_container_client


def upload_blob(blob_path: str, data: bytes | BinaryIO, content_type: str) -> dict:
    """
    Upload a blob to Azure Blob Storage.

    Args:
        blob_path: Blob path within the container (e.g., "users/alice/jobs/123/exports/resume.pdf")
        data: Bytes or file-like object containing the file content
        content_type: MIME type (e.g., "application/pdf", "application/zip")

    Returns:
        Upload result with blob path, URL, and content length

    Raises:
        Exception: If upload fails (blob will be cleaned up automatically)
    """
    container_client = get_container_client()
    blob_client = container_client.get_blob_client(blob_path)

    try:
        # Upload blob with content type
        content_settings = ContentSettings(content_type=content_type)

        upload_response = blob_client.upload_blob(
            data, overwrite=True, content_settings=content_settings
        )

        # Get blob properties to retrieve content length
        properties = blob_client.get_blob_properties()

        return {
            "blob_path": blob_path,
            "url": blob_client.url,
            "content_length": properties.size,
        }
    except Exception as error:
        # Cleanup: attempt to delete partially uploaded blob
        print(f"[BlobUpload] Upload failed for {blob_path}, attempting cleanup...", error)

        try:
            blob_client.delete_blob()
            print(f"[BlobUpload] Cleanup successful for {blob_path}")
        except Exception as cleanup_error:
            print(f"[BlobUpload] Cleanup failed for {blob_path}:", cleanup_error)

        raise error


def upload_blob_from_file(blob_path: str, local_file_path: str, content_type: str) -> dict:
    """
    Upload a blob from a local file path.

    Args:
        blob_path: Blob path within the container
        local_file_path: Path to local file
        content_type: MIME type

    Returns:
        Upload result
    """
    with open(local_file_path, "rb") as file:
        return upload_blob(blob_path, file, content_type)


def delete_blob(blob_path: str) -> bool:
    """
    Delete a blob from Azure Blob Storage.

    Args:
        blob_path: Blob path to delete

    Returns:
        True if blob was deleted, False if it didn't exist
    """
    container_client = get_container_client()
    blob_client = container_client.get_blob_client(blob_path)

    try:
        blob_client.delete_blob()
        return True
    except Exception:
        return False


def blob_exists(blob_path: str) -> bool:
    """
    Check if a blob exists.

    Args:
        blob_path: Blob path to check

    Returns:
        True if blob exists, False otherwise
    """
    container_client = get_container_client()
    blob_client = container_client.get_blob_client(blob_path)

    return blob_client.exists()


def download_blob(blob_path: str) -> bytes:
    """
    Download a blob as bytes.

    Args:
        blob_path: Blob path to download

    Returns:
        Bytes containing blob content
    """
    container_client = get_container_client()
    blob_client = container_client.get_blob_client(blob_path)

    downloader = blob_client.download_blob()
    return downloader.readall()


def build_blob_path(
    owner_user_id: str, job_id: str, blob_type: str, filename: str, timestamp: int | None = None
) -> str:
    """
    Build a blob path for the given owner, job, type, and filename.

    Path Structure:
      users/{owner_user_id}/jobs/{job_id}/{type}/{timestamp}_{filename}

    Args:
        owner_user_id: Owner user ID (e.g., "alice")
        job_id: Job UUID
        blob_type: Blob type ("resume", "jd", "schema", "exports")
        filename: Original filename (will be prefixed with timestamp)
        timestamp: Custom timestamp in milliseconds (defaults to current time)

    Returns:
        Blob path (e.g., "users/alice/jobs/{job_id}/exports/1735142400000_resume.pdf")
    """
    import time

    if timestamp is None:
        timestamp = int(time.time() * 1000)

    sanitized_filename = sanitize_filename(filename)
    return f"users/{owner_user_id}/jobs/{job_id}/{blob_type}/{timestamp}_{sanitized_filename}"


def sanitize_filename(filename: str) -> str:
    """
    Sanitize filename for blob storage.
    - Replace spaces with underscores
    - Remove special characters except dots, hyphens, underscores
    - Limit length to 255 characters

    Args:
        filename: Original filename

    Returns:
        Sanitized filename
    """
    import re

    # Replace spaces with underscores
    filename = filename.replace(" ", "_")

    # Remove special characters
    filename = re.sub(r"[^a-zA-Z0-9._-]", "", filename)

    # Limit length
    return filename[:255]
