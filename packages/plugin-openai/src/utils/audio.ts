import { logger } from "@elizaos/core";

const MAGIC_BYTES = {
  WAV: {
    HEADER: [0x52, 0x49, 0x46, 0x46] as const,
    IDENTIFIER: [0x57, 0x41, 0x56, 0x45] as const,
  },
  MP3_ID3: [0x49, 0x44, 0x33] as const,
  OGG: [0x4f, 0x67, 0x67, 0x53] as const,
  FLAC: [0x66, 0x4c, 0x61, 0x43] as const,
  FTYP: [0x66, 0x74, 0x79, 0x70] as const, // at offset 4 for mp4/m4a
  WEBM_EBML: [0x1a, 0x45, 0xdf, 0xa3] as const,
} as const;

function matchBytes(
  buffer: Buffer,
  offset: number,
  bytes: readonly number[],
): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (buffer[offset + i] !== bytes[i]!) return false;
  }
  return true;
}

/**
 * Detects audio MIME type from buffer by checking magic bytes (file signature)
 * @param buffer The audio buffer to analyze
 * @returns The detected MIME type or 'application/octet-stream' if unknown
 */
export function detectAudioMimeType(buffer: Buffer): string {
  if (buffer.length < 12) {
    return "application/octet-stream";
  }

  // Check magic bytes for common audio formats
  // WAV: "RIFF" + size + "WAVE"
  if (
    matchBytes(buffer, 0, MAGIC_BYTES.WAV.HEADER) &&
    matchBytes(buffer, 8, MAGIC_BYTES.WAV.IDENTIFIER)
  ) {
    return "audio/wav";
  }

  // MP3: ID3 tag or MPEG frame sync
  if (
    matchBytes(buffer, 0, MAGIC_BYTES.MP3_ID3) || // ID3
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) // MPEG sync
  ) {
    return "audio/mpeg";
  }

  // OGG: "OggS"
  if (matchBytes(buffer, 0, MAGIC_BYTES.OGG)) {
    return "audio/ogg";
  }

  // FLAC: "fLaC"
  if (matchBytes(buffer, 0, MAGIC_BYTES.FLAC)) {
    return "audio/flac";
  }

  // M4A/MP4: "ftyp" at offset 4
  if (matchBytes(buffer, 4, MAGIC_BYTES.FTYP)) {
    return "audio/mp4";
  }

  // WebM: EBML header
  if (matchBytes(buffer, 0, MAGIC_BYTES.WEBM_EBML)) {
    return "audio/webm";
  }

  // Unknown format - let API try to detect
  logger.warn(
    "Could not detect audio format from buffer, using generic binary type",
  );
  return "application/octet-stream";
}

/**
 * Converts a Web ReadableStream to a Node.js Readable stream
 * Handles both browser and Node.js environments
 * Uses dynamic import to avoid bundling node:stream in browser builds
 */
export async function webStreamToNodeStream(
  webStream: ReadableStream<Uint8Array>,
) {
  try {
    // Dynamic import to avoid browser bundling issues
    const { Readable } = await import("node:stream");
    const reader = webStream.getReader();

    return new Readable({
      async read() {
        try {
          const { done, value } = await reader.read();
          if (done) {
            this.push(null);
          } else {
            // Push the Uint8Array directly; Node.js Readable can handle it
            this.push(value);
          }
        } catch (error) {
          this.destroy(error as Error);
        }
      },
      destroy(error, callback) {
        reader.cancel().finally(() => callback(error));
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to load node:stream module: ${message}`);
    throw new Error(
      `Cannot convert stream: node:stream module unavailable. This feature requires a Node.js environment.`,
    );
  }
}
