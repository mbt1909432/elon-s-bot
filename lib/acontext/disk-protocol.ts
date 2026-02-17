// Disk Protocol Handler (disk::)
// Handles conversion between disk:: URLs and actual file access
// Updated to use disk:: (double colon) protocol

import { getAcontextClient } from './client';

const DISK_PROTOCOL = 'disk::';

/**
 * Check if a URL uses the disk:: protocol
 */
export function isDiskUrl(url: string): boolean {
  return url.startsWith(DISK_PROTOCOL);
}

/**
 * Parse a disk:: URL to get the file path
 */
export function parseDiskUrl(url: string): string {
  if (!isDiskUrl(url)) {
    throw new Error('Not a disk:: URL');
  }
  return url.slice(DISK_PROTOCOL.length);
}

/**
 * Create a disk:: URL from a file path
 */
export function createDiskUrl(path: string): string {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `${DISK_PROTOCOL}${cleanPath}`;
}

/**
 * Get the public URL for a disk:: file
 */
export async function resolveDiskUrl(
  diskUrl: string,
  diskId: string
): Promise<string | null> {
  if (!isDiskUrl(diskUrl)) {
    return diskUrl; // Return as-is if not a disk URL
  }

  const path = parseDiskUrl(diskUrl);
  const client = getAcontextClient();

  return client.getFileUrl(diskId, path);
}

/**
 * Rewrite all disk:: URLs in content to API URLs
 * Converts disk::path/file.png to /api/artifacts/public-url?filePath=path/file.png&diskId=xxx
 */
export function rewriteDiskPaths(content: string, diskId: string): string {
  // Match disk:: URLs in markdown images and links
  const diskUrlRegex = /disk::([^\s\)"\>]*)/g;

  return content.replace(diskUrlRegex, (match, path) => {
    const encodedPath = encodeURIComponent(path);
    return `/api/artifacts/public-url?filePath=${encodedPath}&diskId=${diskId}`;
  });
}

/**
 * Resolve all disk:: URLs in content to public URLs (async version)
 */
export async function resolveDiskUrlsInContent(
  content: string,
  diskId: string
): Promise<string> {
  // Match disk:: URLs in markdown images and links
  const diskUrlRegex = /disk::([^\s\)"\>]*)/g;

  let resolvedContent = content;
  const matches = content.match(diskUrlRegex);

  if (matches) {
    for (const match of matches) {
      const publicUrl = await resolveDiskUrl(match, diskId);
      if (publicUrl) {
        resolvedContent = resolvedContent.replace(match, publicUrl);
      }
    }
  }

  return resolvedContent;
}

/**
 * Check if a file is an image based on extension
 */
export function isImageFile(path: string): boolean {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'];
  return imageExtensions.some(ext => path.toLowerCase().endsWith(ext));
}

/**
 * Get MIME type for a file based on extension
 */
export function getMimeType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();

  const mimeTypes: Record<string, string> = {
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    // Documents
    pdf: 'application/pdf',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    // Data
    csv: 'text/csv',
    xml: 'application/xml',
    // Text
    txt: 'text/plain',
    md: 'text/markdown',
    // Code
    py: 'text/x-python',
    ts: 'text/typescript',
    tsx: 'text/typescript-jsx',
    jsx: 'text/jsx',
  };

  return mimeTypes[extension || ''] || 'application/octet-stream';
}
