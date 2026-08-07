import * as yauzl from "yauzl";
import type { Readable } from "node:stream";
import { MAX_XLSX_WORKSHEETS } from "./limits";

const MAX_ZIP_ENTRIES = 256;
const MAX_FILENAME_BYTES = 240;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 24 * 1024 * 1024;
const MAX_EXPANSION_RATIO = 200;
const PREFLIGHT_TIMEOUT_MS = 5_000;

const SAFE_ARCHIVE_ERROR = "XLSX archive exceeds safe expansion limits.";

async function inspectArchive(buffer: Buffer): Promise<void> {
  const zip = await yauzl.fromBufferPromise(buffer, {
    lazyEntries: true,
    decodeStrings: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  let activeStream: Readable | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const validate = async () => {
    if (zip.entryCount < 1 || zip.entryCount > MAX_ZIP_ENTRIES) throw new Error("entry count");
    const names = new Set<string>();
    let declaredTotal = 0;
    let observedTotal = 0;
    let worksheetCount = 0;
    let hasContentTypes = false;
    let hasRootRelationships = false;
    let hasWorkbook = false;

    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      const foldedName = name.toLocaleLowerCase("en-US");
      if (entry.fileNameRaw.byteLength > MAX_FILENAME_BYTES || names.has(foldedName)) throw new Error("unsafe name");
      names.add(foldedName);
      if (entry.isEncrypted() || !entry.canDecodeFileData() || ![0, 8].includes(entry.compressionMethod)) throw new Error("unsupported entry");
      if (!Number.isSafeInteger(entry.compressedSize) || !Number.isSafeInteger(entry.uncompressedSize)) throw new Error("invalid size");
      if (entry.compressedSize < 0 || entry.uncompressedSize < 0 || entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) throw new Error("entry size");

      declaredTotal += entry.uncompressedSize;
      if (!Number.isSafeInteger(declaredTotal) || declaredTotal > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new Error("archive size");
      const ratio = entry.uncompressedSize / Math.max(1, entry.compressedSize);
      if (ratio > MAX_EXPANSION_RATIO) throw new Error("expansion ratio");

      if (foldedName === "[content_types].xml") hasContentTypes = true;
      if (foldedName === "_rels/.rels") hasRootRelationships = true;
      if (foldedName === "xl/workbook.xml") hasWorkbook = true;
      if (/^xl\/worksheets\/[^/]+\.xml$/.test(foldedName)) worksheetCount += 1;
      if (worksheetCount > MAX_XLSX_WORKSHEETS) throw new Error("worksheet count");
      if (foldedName === "xl/vbaproject.bin" || foldedName.startsWith("xl/activex/") || foldedName.startsWith("xl/embeddings/")) {
        throw new Error("active content");
      }

      const stream = await zip.openReadStreamPromise(entry);
      activeStream = stream;
      let observedEntry = 0;
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk));
        observedEntry += bytes;
        observedTotal += bytes;
        if (observedEntry > MAX_ENTRY_UNCOMPRESSED_BYTES || observedTotal > MAX_TOTAL_UNCOMPRESSED_BYTES) {
          stream.destroy(new Error("observed size"));
          throw new Error("observed size");
        }
      }
      activeStream = null;
    }

    if (!hasContentTypes || !hasRootRelationships || !hasWorkbook || worksheetCount < 1) throw new Error("missing workbook parts");
  };

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("archive timeout");
      activeStream?.destroy(error);
      if (zip.isOpen) zip.close();
      reject(error);
    }, PREFLIGHT_TIMEOUT_MS);
  });

  try {
    await Promise.race([validate(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (zip.isOpen) zip.close();
  }
}

export async function assertSafeXlsxArchive(input: ArrayBuffer): Promise<void> {
  try {
    await inspectArchive(Buffer.from(input));
  } catch {
    throw new Error(SAFE_ARCHIVE_ERROR);
  }
}
