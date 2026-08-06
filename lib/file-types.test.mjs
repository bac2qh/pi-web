import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

async function loadSubject() {
  return import("./file-types.ts");
}

test("detects image, audio, and document preview paths", async () => {
  const {
    getAudioMime,
    getDocumentMime,
    getImageMime,
    isAudioPath,
    isDocumentPreviewPath,
    isImagePath,
  } = await loadSubject();

  assert.equal(getImageMime("/tmp/screenshot.PNG"), "image/png");
  assert.equal(getAudioMime("C:\\Users\\me\\voice.OPUS"), "audio/ogg");
  assert.equal(getDocumentMime("/tmp/report.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(isImagePath("/tmp/screenshot.PNG"), true);
  assert.equal(isAudioPath("C:\\Users\\me\\voice.OPUS"), true);
  assert.equal(isDocumentPreviewPath("/tmp/report.pdf"), true);
  assert.equal(isDocumentPreviewPath("/tmp/report.txt"), false);
});

test("extracts extensions from mixed path styles", async () => {
  const { documentPreviewKind, getFileExt } = await loadSubject();

  assert.equal(getFileExt("/tmp/archive.tar.gz"), "gz");
  assert.equal(getFileExt("C:\\Users\\me\\photo.AVIF"), "avif");
  assert.equal(documentPreviewKind("/tmp/manual.PDF"), "pdf");
  assert.equal(documentPreviewKind("/tmp/manual.md"), null);
});

test("shares source, configuration, and established text filename eligibility", async () => {
  const { getFileLanguage, isAutomaticTextPreviewPath } = await loadSubject();

  for (const filePath of [
    "README", "LICENSE", "Dockerfile", "Dockerfile.dev", "Dockerfile.test", "Makefile",
    ".env.local", ".env.production", ".env.production.local",
    ".gitignore", "AGENTS.md", "components/AppShell.TSX", "config/settings.YML",
    "package.json", "scripts/release.sh", "infra/main.tf", "notes.txt",
    ".env.production.ts", "Dockerfile.custom.ts",
  ]) {
    assert.equal(isAutomaticTextPreviewPath(filePath), true, filePath);
  }
  for (const filePath of [
    "report.pdf", "image.png", "recording.mp3", "document.docx",
    ".env.png", ".env.MP3", ".env.zip", ".env.sqlite", ".env.com", ".env.zst",
    "Dockerfile.pdf", "Dockerfile.DOCX", "Dockerfile.exe", "Dockerfile.wasm",
    "Dockerfile.msi", "Dockerfile.so", "Dockerfile.cab", "archive.bin",
    "payload.unknown", "arbitrary-extensionless",
  ]) {
    assert.equal(isAutomaticTextPreviewPath(filePath), false, filePath);
  }

  assert.equal(getFileLanguage("Dockerfile.dev"), "dockerfile");
  assert.equal(getFileLanguage(".env.production"), "bash");
  assert.equal(getFileLanguage("Makefile"), "makefile");
  assert.equal(getFileLanguage("src/view.tsx"), "typescript");
  assert.equal(getFileLanguage("unknown.data"), "text");
});

test("decodes only bounded NUL-free valid UTF-8 text", async () => {
  const {
    TEXT_PREVIEW_MAX_BYTES,
    TEXT_PREVIEW_TOO_LARGE_ERROR,
    TEXT_PREVIEW_UNSUPPORTED_ERROR,
    decodeTextPreviewBytes,
  } = await loadSubject();

  const exact = decodeTextPreviewBytes(new Uint8Array(TEXT_PREVIEW_MAX_BYTES).fill(0x61));
  assert.equal(exact.ok, true);
  assert.equal(exact.ok && exact.content.length, TEXT_PREVIEW_MAX_BYTES);

  assert.deepEqual(
    decodeTextPreviewBytes(new Uint8Array(TEXT_PREVIEW_MAX_BYTES + 1).fill(0x61)),
    { ok: false, kind: "too_large", error: TEXT_PREVIEW_TOO_LARGE_ERROR },
  );
  assert.deepEqual(
    decodeTextPreviewBytes(Uint8Array.from([0x61, 0x00, 0x62])),
    { ok: false, kind: "unsupported", error: TEXT_PREVIEW_UNSUPPORTED_ERROR },
  );
  assert.deepEqual(
    decodeTextPreviewBytes(Uint8Array.from([0xc3, 0x28])),
    { ok: false, kind: "unsupported", error: TEXT_PREVIEW_UNSUPPORTED_ERROR },
  );

  const valid = decodeTextPreviewBytes(new TextEncoder().encode("héllo 🌍"));
  assert.deepEqual(valid, { ok: true, content: "héllo 🌍" });
});

test("reads no more than one byte beyond the authoritative text ceiling", async (t) => {
  const { TEXT_PREVIEW_MAX_BYTES, decodeTextPreviewBytes } = await loadSubject();
  const { readTextPreviewBytes } = await jiti.import("./text-preview-file.ts");
  const directory = mkdtempSync(join(tmpdir(), "pi-web-text-preview-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const exactPath = join(directory, "exact.txt");
  const oversizedPath = join(directory, "oversized.txt");
  writeFileSync(exactPath, Buffer.alloc(TEXT_PREVIEW_MAX_BYTES, 0x61));
  writeFileSync(oversizedPath, Buffer.alloc(TEXT_PREVIEW_MAX_BYTES * 4, 0x62));

  const exact = readTextPreviewBytes(exactPath);
  const oversized = readTextPreviewBytes(oversizedPath);
  assert.equal(exact.byteLength, TEXT_PREVIEW_MAX_BYTES);
  assert.equal(oversized.byteLength, TEXT_PREVIEW_MAX_BYTES + 1);
  assert.deepEqual(decodeTextPreviewBytes(oversized), {
    ok: false,
    kind: "too_large",
    error: "File too large for preview (>256KB)",
  });
});
