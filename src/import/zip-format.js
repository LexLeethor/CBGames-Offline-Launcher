"use strict";

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let j = 0; j < 8; j += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

async function readFileArrayBufferWithProgress(file, label) {
    if (!file || typeof file.arrayBuffer !== "function") {
      return new ArrayBuffer(0);
    }
    const total = Number(file.size) || 0;
    const displayLabel = String(label || "Reading file");
    if (!file.stream || typeof file.stream !== "function") {
      setWorkProgress(displayLabel, 0, 0);
      return file.arrayBuffer();
    }
    const reader = file.stream().getReader();
    // File.size is exact for immutable File/Blob inputs, so fill one buffer rather than retaining chunks and copying them again.
    const output = Number.isSafeInteger(total) && total > 0 ? new Uint8Array(total) : null;
    const chunks = output ? null : [];
    let loaded = 0;
    let lastReported = 0;
    const start = performance.now();

    if (total > 0) {
      setWorkProgress(
        displayLabel,
        0,
        total,
        { currentText: formatBytes(0), totalText: formatBytes(total) }
      );
    } else {
      setWorkProgress(displayLabel, 0, 0);
    }

    while (true) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      const chunk = part.value;
      if (!chunk) {
        continue;
      }
      if (output) {
        if (loaded + chunk.byteLength > output.byteLength) {
          throw new Error("File size changed while reading " + displayLabel + ".");
        }
        output.set(chunk, loaded);
      } else {
        chunks.push(chunk);
      }
      loaded += chunk.byteLength;
      if (loaded - lastReported >= 262144 || (total > 0 && loaded >= total)) {
        if (total > 0) {
          const etaText = formatEtaSeconds(estimateEtaSeconds(start, loaded, total));
          setWorkProgress(
            displayLabel,
            loaded,
            total,
            { currentText: formatBytes(loaded), totalText: formatBytes(total), etaText }
          );
        } else {
          setWorkProgress(displayLabel + " (" + formatBytes(loaded) + ")", 0, 0);
        }
        lastReported = loaded;
      }
    }

    if (total > 0) {
      const etaText = formatEtaSeconds(estimateEtaSeconds(start, loaded, total));
      setWorkProgress(
        displayLabel,
        loaded,
        total,
        { currentText: formatBytes(loaded), totalText: formatBytes(total), etaText }
      );
    } else if (loaded > 0) {
      setWorkProgress(
        displayLabel,
        loaded,
        loaded,
        { currentText: formatBytes(loaded), totalText: formatBytes(loaded) }
      );
    } else {
      setWorkProgress(displayLabel, 1, 1);
    }

    if (output) {
      return output.buffer;
    }
    const blob = new Blob(chunks, { type: file.type || "application/octet-stream" });
    return blob.arrayBuffer();
  }

function findEocdOffset(bytes) {
    // A ZIP comment may occupy 65,535 bytes, so the EOCD signature can be near the tail.
    const minEocdLength = 22;
    const maxCommentLength = 65535;
    const start = Math.max(0, bytes.length - minEocdLength - maxCommentLength);
    for (let i = bytes.length - minEocdLength; i >= start; i -= 1) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x05 &&
        bytes[i + 3] === 0x06
      ) {
        return i;
      }
    }
    return -1;
  }

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

function createZipStoreArchive(entries) {
    // Store entries uncompressed so the browser can build ZIPs without another compression library.
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    let centralSize = 0;

    for (const entry of entries) {
      const name = normalizePath(entry.path || "");
      const data = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes || []);
      const nameBytes = encoder.encode(name);
      const checksum = crc32(data);

      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0, true);
      localView.setUint16(8, 0, true); // store
      localView.setUint16(10, 0, true);
      localView.setUint16(12, 0, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);
      localParts.push(localHeader, data);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, 0, true);
      centralView.setUint16(14, 0, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, localOffset, true);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);
      centralSize += centralHeader.length;

      localOffset += localHeader.length + data.length;
    }

    const centralOffset = localOffset;
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, entries.length, true);
    eocdView.setUint16(10, entries.length, true);
    eocdView.setUint32(12, centralSize, true);
    eocdView.setUint32(16, centralOffset, true);
    eocdView.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, eocd], { type: "application/zip" });
  }

function parseZipArchive(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const eocdOffset = findEocdOffset(bytes);
    if (eocdOffset === -1) {
      throw new Error("Invalid ZIP: end-of-central-directory record not found.");
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
    const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);

    if (
      totalEntries === 0xffff ||
      centralDirectorySize === 0xffffffff ||
      centralDirectoryOffset === 0xffffffff
    ) {
      throw new Error("ZIP64 archives are not supported yet.");
    }

    const end = centralDirectoryOffset + centralDirectorySize;
    if (end > bytes.length) {
      throw new Error("Invalid ZIP: central directory outside file bounds.");
    }

    const decoder = new TextDecoder("utf-8");
    const entries = [];
    let offset = centralDirectoryOffset;

    for (let i = 0; i < totalEntries; i += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error("Invalid ZIP: bad central directory header.");
      }

      const flags = view.getUint16(offset + 8, true);
      const compressionMethod = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const fileNameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localHeaderOffset = view.getUint32(offset + 42, true);

      const nameStart = offset + 46;
      const nameEnd = nameStart + fileNameLength;
      const nameBytes = bytes.subarray(nameStart, nameEnd);
      const path = normalizePath(decoder.decode(nameBytes));

      offset = nameEnd + extraLength + commentLength;

      if (!path || path.endsWith("/")) {
        continue;
      }

      entries.push({
        path,
        flags,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      });
    }

    return { bytes, view, entries };
  }

function getCompressedEntrySlice(zip, entry) {
    const localOffset = entry.localHeaderOffset;
    if (zip.view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error("Invalid ZIP: bad local header for " + entry.path);
    }

    const fileNameLength = zip.view.getUint16(localOffset + 26, true);
    const extraLength = zip.view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + fileNameLength + extraLength;
    const dataEnd = dataOffset + entry.compressedSize;

    if (dataEnd > zip.bytes.length) {
      throw new Error("Invalid ZIP: data overflow for " + entry.path);
    }

    return zip.bytes.subarray(dataOffset, dataEnd);
  }

async function inflateDeflateRaw(data) {
    if (!("DecompressionStream" in window)) {
      throw new Error("This browser does not support ZIP extraction in file:// mode (missing DecompressionStream).");
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

async function inflateBrotli(data) {
  setWorkProgress("Inflating Brotli Data", 0, 0);
    if ("DecompressionStream" in window) {
      try {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("brotli"));
        const buffer = await new Response(stream).arrayBuffer();
        return new Uint8Array(buffer);
      } catch (error) {
        console.warn("Native Brotli decompression failed, falling back to JS decoder.", error);
      }
    }
    if (typeof window.BrotliDecode === "function") {
      const decoded = window.BrotliDecode(new Uint8Array(data));
      return decoded instanceof Uint8Array ? decoded : new Uint8Array(decoded);
    }
    throw new Error("Brotli decode not available (missing DecompressionStream and BrotliDecode).");
  }

async function extractEntryBytes(zip, entry) {
    setWorkProgress("Figuring out zip type");
    if (entry.flags & 0x1) {
      throw new Error("Encrypted ZIP entries are not supported: " + entry.path);
    }

    const compressed = getCompressedEntrySlice(zip, entry);

    if (entry.compressionMethod === 0) {
      return compressed.slice();
    }
    if (entry.compressionMethod === 8) {
      setWorkProgress("Inflating Contents");
      const decompressed = await inflateDeflateRaw(compressed);
      return decompressed;
    }
    if (entry.compressionMethod === 12) {
      console.log("Inflating BZ2 entry");
      const decompressed = await inflateBZ2(compressed);
      return decompressed;
    }
        if (entry.compressionMethod === 14) {
      console.log("Inflating LZMA entry");
      const decompressed = await inflateLZMA(compressed);
      return decompressed;
    }

    throw new Error(
      "Unsupported ZIP compression method " + entry.compressionMethod + " for " + entry.path
    );
  }
