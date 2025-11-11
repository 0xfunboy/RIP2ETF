import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import type {
  OpenAITranscriptionParams,
  OpenAITextToSpeechParams,
} from "../types";
import {
  getSetting,
  getBaseURL,
  getAuthHeader,
  isBrowser,
} from "../utils/config";
import { detectAudioMimeType, webStreamToNodeStream } from "../utils/audio";

/**
 * Helper function for text-to-speech
 */
async function fetchTextToSpeech(
  runtime: IAgentRuntime,
  options: OpenAITextToSpeechParams,
) {
  const defaultModel = getSetting(
    runtime,
    "OPENAI_TTS_MODEL",
    "gpt-4o-mini-tts",
  );
  const defaultVoice = getSetting(runtime, "OPENAI_TTS_VOICE", "nova");
  const defaultInstructions = getSetting(
    runtime,
    "OPENAI_TTS_INSTRUCTIONS",
    "",
  );
  const baseURL = getBaseURL(runtime);

  const model = options.model || (defaultModel as string);
  const voice = options.voice || (defaultVoice as string);
  const instructions = options.instructions ?? (defaultInstructions as string);
  const format = options.format || "mp3";

  try {
    const res = await fetch(`${baseURL}/audio/speech`, {
      method: "POST",
      headers: {
        ...getAuthHeader(runtime),
        "Content-Type": "application/json",
        // Hint desired audio format in Accept when possible
        ...(format === "mp3" ? { Accept: "audio/mpeg" } : {}),
      },
      body: JSON.stringify({
        model,
        voice,
        input: options.text,
        format,
        ...(instructions && { instructions }),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI TTS error ${res.status}: ${err}`);
    }

    // Ensure response body exists
    if (!res.body) {
      throw new Error("OpenAI TTS response body is null");
    }

    // In Node.js, convert Web ReadableStream to Node.js Readable
    // In browser, return the Web ReadableStream directly
    if (!isBrowser()) {
      return await webStreamToNodeStream(res.body);
    }

    return res.body;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch speech from OpenAI TTS: ${message}`);
  }
}

/**
 * TRANSCRIPTION model handler
 */
export async function handleTranscription(
  runtime: IAgentRuntime,
  input: Blob | File | Buffer | OpenAITranscriptionParams,
): Promise<string> {
  let modelName = getSetting(
    runtime,
    "OPENAI_TRANSCRIPTION_MODEL",
    "gpt-4o-mini-transcribe",
  );
  logger.log(`[OpenAI] Using TRANSCRIPTION model: ${modelName}`);

  const baseURL = getBaseURL(runtime);

  // Support Blob/File/Buffer directly, or an object with { audio: Blob/File/Buffer, ...options }
  let blob: Blob;
  let extraParams: OpenAITranscriptionParams | null = null;

  if (input instanceof Blob || input instanceof File) {
    blob = input as Blob;
  } else if (Buffer.isBuffer(input)) {
    // Convert Buffer to Blob for Node.js environments
    // Auto-detect MIME type from buffer content
    const detectedMimeType = detectAudioMimeType(input);
    logger.debug(`Auto-detected audio MIME type: ${detectedMimeType}`);
    // Create a new Uint8Array from the Buffer to ensure type compatibility
    const uint8Array = new Uint8Array(input);
    blob = new Blob([uint8Array], { type: detectedMimeType });
  } else if (
    typeof input === "object" &&
    input !== null &&
    (input as any).audio != null
  ) {
    const params = input as any;
    if (
      !(params.audio instanceof Blob) &&
      !(params.audio instanceof File) &&
      !Buffer.isBuffer(params.audio)
    ) {
      throw new Error(
        "TRANSCRIPTION param 'audio' must be a Blob/File/Buffer.",
      );
    }
    // Convert Buffer to Blob if needed
    if (Buffer.isBuffer(params.audio)) {
      // Use provided mimeType or auto-detect from buffer
      let mimeType = params.mimeType;
      if (!mimeType) {
        mimeType = detectAudioMimeType(params.audio);
        logger.debug(`Auto-detected audio MIME type: ${mimeType}`);
      } else {
        logger.debug(`Using provided MIME type: ${mimeType}`);
      }
      // Create a new Uint8Array from the Buffer to ensure type compatibility
      const uint8Array = new Uint8Array(params.audio);
      blob = new Blob([uint8Array], { type: mimeType });
    } else {
      blob = params.audio as Blob;
    }
    extraParams = params as OpenAITranscriptionParams;
    if (typeof params.model === "string" && params.model) {
      modelName = params.model;
    }
  } else {
    throw new Error(
      "TRANSCRIPTION expects a Blob/File/Buffer or an object { audio: Blob/File/Buffer, mimeType?, language?, response_format?, timestampGranularities?, prompt?, temperature?, model? }",
    );
  }

  const mime = (blob as File).type || "audio/webm";
  const filename =
    (blob as File).name ||
    (mime.includes("mp3") || mime.includes("mpeg")
      ? "recording.mp3"
      : mime.includes("ogg")
        ? "recording.ogg"
        : mime.includes("wav")
          ? "recording.wav"
          : mime.includes("webm")
            ? "recording.webm"
            : "recording.bin");

  const formData = new FormData();
  formData.append("file", blob, filename);
  formData.append("model", String(modelName));
  if (extraParams) {
    if (typeof extraParams.language === "string") {
      formData.append("language", String(extraParams.language));
    }
    if (typeof extraParams.response_format === "string") {
      formData.append("response_format", String(extraParams.response_format));
    }
    if (typeof extraParams.prompt === "string") {
      formData.append("prompt", String(extraParams.prompt));
    }
    if (typeof extraParams.temperature === "number") {
      formData.append("temperature", String(extraParams.temperature));
    }
    if (Array.isArray(extraParams.timestampGranularities)) {
      for (const g of extraParams.timestampGranularities) {
        formData.append("timestamp_granularities[]", String(g));
      }
    }
  }

  try {
    const response = await fetch(`${baseURL}/audio/transcriptions`, {
      method: "POST",
      headers: {
        ...getAuthHeader(runtime),
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to transcribe audio: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { text: string };
    return data.text || "";
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`TRANSCRIPTION error: ${message}`);
    throw error;
  }
}

/**
 * TEXT_TO_SPEECH model handler
 */
export async function handleTextToSpeech(
  runtime: IAgentRuntime,
  input: string | OpenAITextToSpeechParams,
): Promise<ReadableStream<Uint8Array> | NodeJS.ReadableStream> {
  // Normalize input into options with per-call overrides
  const options: OpenAITextToSpeechParams =
    typeof input === "string"
      ? { text: input }
      : (input as OpenAITextToSpeechParams);

  const resolvedModel =
    options.model ||
    (getSetting(runtime, "OPENAI_TTS_MODEL", "gpt-4o-mini-tts") as string);
  logger.log(`[OpenAI] Using TEXT_TO_SPEECH model: ${resolvedModel}`);
  try {
    const speechStream = await fetchTextToSpeech(runtime, options);
    return speechStream;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Error in TEXT_TO_SPEECH: ${message}`);
    throw error;
  }
}
