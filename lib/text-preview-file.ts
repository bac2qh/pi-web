import fs from "node:fs";
import { TEXT_PREVIEW_MAX_BYTES } from "./file-types";

/** Read at most one byte beyond the text-preview ceiling from one file identity. */
export function readTextPreviewBytes(filePath: string): Uint8Array {
  const file = fs.openSync(filePath, "r");
  try {
    const bytes = Buffer.allocUnsafe(TEXT_PREVIEW_MAX_BYTES + 1);
    let total = 0;
    while (total < bytes.byteLength) {
      const read = fs.readSync(file, bytes, total, bytes.byteLength - total, null);
      if (read === 0) break;
      total += read;
    }
    return bytes.subarray(0, total);
  } finally {
    fs.closeSync(file);
  }
}
