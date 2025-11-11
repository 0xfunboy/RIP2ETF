import type { Telegraf } from 'telegraf';

export type MediaPayload = {
  buffer: Buffer;
  filename?: string;
  mimeType?: string;
  caption?: string;
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
};

function inferFilename(base?: string, mime?: string) {
  if (base) return base;
  if (!mime) return 'image.bin';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'image.jpg';
  if (mime.includes('png')) return 'image.png';
  if (mime.includes('webp')) return 'image.webp';
  return 'image.bin';
}

/**
 * Sends an image via Telegram's sendPhoto endpoint and falls back to sendDocument when needed.
 */
export async function sendPhotoWithFallback(
  bot: Telegraf,
  chatId: number | string,
  media: MediaPayload
) {
  const filename = inferFilename(media.filename, media.mimeType);
  try {
    await bot.telegram.sendPhoto(
      chatId,
      { source: media.buffer, filename },
      { caption: media.caption, parse_mode: media.parse_mode }
    );
    return { ok: true, as: 'photo' as const };
  } catch (error) {
    try {
      await bot.telegram.sendDocument(
        chatId,
        { source: media.buffer, filename },
        { caption: media.caption, parse_mode: media.parse_mode }
      );
      return { ok: true, as: 'document' as const, fallback: true };
    } catch (errorDocument) {
      return { ok: false, error, fallbackError: errorDocument };
    }
  }
}
