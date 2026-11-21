import { cleanFileName } from "@hussmartinez/sdk-core";

/** The extensions of the files the SDK reads and writes, which the export puts back. */
const AUDIO_EXTENSION = /\.(wav|wave|mp3|m4a|mp4|aac|adts|flac|ogg|oga|opus|weba|webm)$/iu;

/** A name cleaned as the family cleans one, then without an audio extension. */
function withoutAudioExtension(raw: string | undefined): string | undefined {
  const clean = cleanFileName(raw);
  return clean === undefined ? undefined : cleanFileName(clean.replace(AUDIO_EXTENSION, ""));
}

/**
 * The name an export is downloaded under, without its extension, as
 * video-sdk names its exports: the host's `fileName`, or else the
 * recording's title, or else "recording". Both are cleaned as the family
 * cleans a file name
 * ([pdf-sdk ADR 0009](https://github.com/ie-huss-martinez/pdf-sdk/blob/main/docs/adr/0009-saving-the-document.md)):
 * the last path segment only, without control or bidirectional formatting
 * characters or the characters Windows refuses, without leading dots, and
 * at most 128 code points. Then an audio extension the host left on is
 * dropped, as the export adds its own.
 *
 * @internal
 */
export function exportFileName(fileName: string | undefined, title: string): string {
  return withoutAudioExtension(fileName) ?? withoutAudioExtension(title) ?? "recording";
}
