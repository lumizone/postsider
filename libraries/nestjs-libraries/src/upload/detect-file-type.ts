/**
 * Detect the real MIME type of a buffer via the ESM-only `file-type` package.
 *
 * `file-type` v16+ is pure ESM, so a top-level CommonJS `require()` breaks
 * under the Jest CJS resolver (and older bundlers). Dynamic `import()` works
 * in both the Nest runtime and Jest. The default-`?.` chain keeps a fallback
 * for interop shapes that expose the API on `.default`.
 */
export interface DetectedFileType {
  mime: string;
  ext: string;
}

export async function detectFileType(
  buffer: Buffer
): Promise<DetectedFileType | undefined> {
  const mod: any = await import('file-type');
  const fileTypeFromBuffer: ((b: Buffer) => Promise<DetectedFileType | undefined>) | undefined =
    mod?.fileTypeFromBuffer ?? mod?.fromBuffer ?? mod?.default?.fileTypeFromBuffer;

  if (typeof fileTypeFromBuffer !== 'function') {
    throw new Error(
      'file-type: no compatible export found (expected fileTypeFromBuffer)'
    );
  }

  return fileTypeFromBuffer(buffer);
}
