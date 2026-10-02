/**
 * Source files that are not UTF-8. Windows tools still write UTF-16 with a byte-order mark:
 * PowerShell scripts saved by the ISE, `.reg` and resource files, anything redirected with
 * `>` in Windows PowerShell. Such a file is full of zero bytes, so it used to be skipped as
 * "binary" and the scan passed without having read it. The mark decides the encoding; the
 * text is scanned like any other, and `--fix` writes it back in the encoding it came in.
 */

export type FileEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

export function fileEncoding(bytes: Uint8Array): FileEncoding {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return 'utf-8';
}

/** The file's text. A UTF-16 mark is the encoding's signature and is left out; UTF-8 is read as it always was. */
export function decodeFile(bytes: Buffer): { text: string; encoding: FileEncoding } {
  const encoding = fileEncoding(bytes);
  if (encoding === 'utf-8') return { text: bytes.toString('utf8'), encoding };
  return { text: new TextDecoder(encoding).decode(bytes), encoding };
}

/** `text` as bytes in `encoding`, with the mark a UTF-16 file starts with. */
export function encodeFile(text: string, encoding: FileEncoding): Buffer {
  if (encoding === 'utf-8') return Buffer.from(text, 'utf8');
  const bytes = Buffer.from(String.fromCharCode(0xfeff) + text, 'utf16le');
  return encoding === 'utf-16be' ? bytes.swap16() : bytes;
}
