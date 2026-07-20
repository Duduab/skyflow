export interface ImageCompressionOptions {
  /** Longest edge, in px, that the output image is resized to. */
  maxDimension?: number;
  quality?: number;
  mimeType?: 'image/jpeg' | 'image/webp';
}

const DEFAULT_OPTIONS: Required<ImageCompressionOptions> = {
  maxDimension: 1600,
  quality: 0.82,
  mimeType: 'image/jpeg',
};

/**
 * Resizes/re-encodes an image File on the client (canvas + toBlob) before upload,
 * so phone-camera photos (often 4-8MB) don't get sent over the wire at full size.
 * Non-image files (e.g. PDFs) and anything that fails to shrink are returned unchanged.
 */
export async function compressImageFile(
  file: File,
  options: ImageCompressionOptions = {},
): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return file;
  }
  const { maxDimension, quality, mimeType } = { ...DEFAULT_OPTIONS, ...options };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeType, quality),
    );
    if (!blob || blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^./\\]+$/, '') + '.jpg';
    return new File([blob], newName, { type: mimeType, lastModified: Date.now() });
  } catch {
    return file;
  }
}
