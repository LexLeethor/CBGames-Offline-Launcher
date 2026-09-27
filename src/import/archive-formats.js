"use strict";

function readTarString(bytes, start, length) {
  let end = start;
  const limit = Math.min(bytes.length, start + length);
  while (end < limit && bytes[end] !== 0) end += 1;
  return new TextDecoder().decode(bytes.subarray(start, end));
}

function readTarNumber(bytes, start, length) {
  if (start < 0 || length < 1 || start + length > bytes.length) {
    throw new Error("Invalid TAR numeric field.");
  }

  // TAR normally uses octal text. GNU/POSIX extensions may use base-256.
  if (bytes[start] & 0x80) {
    const negative = (bytes[start] & 0x40) !== 0;
    let value = BigInt(bytes[start] & 0x7f);
    for (let i = start + 1; i < start + length; i += 1) {
      value = (value << 8n) | BigInt(bytes[i]);
    }
    if (negative) {
      const bitCount = BigInt(length * 8 - 1);
      value -= 1n << bitCount;
    }
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("TAR numeric field is outside the supported range.");
    }
    return Number(value);
  }

  const raw = readTarString(bytes, start, length).trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) throw new Error("Invalid TAR numeric field.");
  const value = parseInt(raw, 8);
  if (!Number.isSafeInteger(value)) throw new Error("TAR numeric field is outside the supported range.");
  return value;
}

function parsePaxRecords(bytes) {
  const records = {};
  let offset = 0;
  const decoder = new TextDecoder();
  while (offset < bytes.length) {
    let space = offset;
    while (space < bytes.length && bytes[space] !== 0x20) space += 1;
    if (space === bytes.length) throw new Error("Invalid TAR PAX record.");
    const recordLength = Number(decoder.decode(bytes.subarray(offset, space)));
    if (!Number.isSafeInteger(recordLength) || recordLength <= space - offset + 1 || offset + recordLength > bytes.length) {
      throw new Error("Invalid TAR PAX record length.");
    }
    const record = decoder.decode(bytes.subarray(space + 1, offset + recordLength - 1));
    const equals = record.indexOf("=");
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1);
    offset += recordLength;
  }
  return records;
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function parseTarArchive(input, onEntryPath) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = [];
  const entryPaths = [];
  const decoder = new TextDecoder();
  let offset = 0;
  let localPax = {};
  let globalPax = {};
  let longName = "";
  let headersSinceYield = 0;
  let nextTreeUpdateAt = 1;

  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    let storedChecksum;
    let size;
    try {
      storedChecksum = readTarNumber(header, 148, 8);
    } catch (error) {
      throw new Error("Invalid TAR header checksum field: " + error.message);
    }
    let calculatedChecksum = 0;
    for (let i = 0; i < 512; i += 1) {
      calculatedChecksum += i >= 148 && i < 156 ? 32 : header[i];
    }
    if (storedChecksum !== calculatedChecksum) throw new Error("Invalid TAR header checksum.");
    try {
      size = readTarNumber(header, 124, 12);
    } catch (error) {
      throw new Error("Invalid TAR entry size field: " + error.message);
    }

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > bytes.length) {
      throw new Error("TAR entry extends beyond the archive.");
    }
    const type = header[156];
    let name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    if (prefix) name = prefix + "/" + name;
    let data = bytes.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === 120 || type === 103) {
      const pax = parsePaxRecords(data);
      if (type === 103) globalPax = { ...globalPax, ...pax };
      else localPax = pax;
    } else if (type === 76 || type === 75) {
      const value = decoder.decode(data).replace(/\0.*$/s, "").replace(/[\r\n]+$/, "");
      if (type === 76) longName = value;
    } else {
      const pax = { ...globalPax, ...localPax };
      name = longName || pax.path || name;
      if (pax.size !== undefined) {
        const paxSize = Number(pax.size);
        if (!Number.isSafeInteger(paxSize) || paxSize < 0 || dataStart + paxSize > bytes.length) {
          throw new Error("Invalid TAR PAX entry size.");
        }
        data = bytes.subarray(dataStart, dataStart + paxSize);
        offset = dataStart + Math.ceil(paxSize / 512) * 512;
      }
      longName = "";
      localPax = {};

      // Files only: directory and link records carry no game payload themselves.
      if (type === 0 || type === 48 || type === 55) {
        const slashName = name.replace(/\\/g, "/");
        const segments = slashName.split("/").filter((segment) => segment && segment !== ".");
        const path = normalizePath(segments.join("/"));
        if (!path || slashName.startsWith("/") || /^[A-Za-z]:/.test(slashName) || segments.includes("..")) {
          if (path) console.warn("Skipping unsafe TAR path:", name);
        } else {
          entries.push({ path, bytes: data });
          entryPaths.push(path);
          // Refresh at widening intervals so drawing a growing tree does not become quadratic.
          if (typeof onEntryPath === "function" && entries.length >= nextTreeUpdateAt) {
            onEntryPath(path, entryPaths);
            nextTreeUpdateAt = Math.max(nextTreeUpdateAt + 32, nextTreeUpdateAt * 2);
          }
        }
      }
    }

    headersSinceYield += 1;
    if (headersSinceYield >= 128) {
      headersSinceYield = 0;
      await yieldToBrowser();
    }
  }

  if (!entries.length) throw new Error("TAR archive contains no regular files.");
  if (typeof onEntryPath === "function") {
    onEntryPath(entryPaths[entryPaths.length - 1], entryPaths);
  }
  return entries;
}

async function readDecompressedStream(stream, label, reportProgress) {
  const shouldReportProgress = reportProgress !== false;
  // Decompression runs in a worker; transferred chunks are owned by this thread.
  // Keep large archive assembly and TAR header scans yielding as well.
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  let bytesSinceYield = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (!part.value || !part.value.byteLength) continue;
      total += part.value.byteLength;
      if (!Number.isSafeInteger(total)) {
        await reader.cancel();
        throw new Error("Uncompressed archive is too large to represent safely in this browser.");
      }
      // Worker streams transfer chunk ownership to this thread; retain the chunk directly.
      chunks.push(part.value);
      bytesSinceYield += part.value.byteLength;
      if (bytesSinceYield >= 2 * 1024 * 1024) {
        bytesSinceYield = 0;
        if (shouldReportProgress) setWorkProgress(label + " (" + formatBytes(total) + ")", 0, 0);
        await yieldToBrowser();
      }
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  let copiedSinceYield = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    output.set(chunk, offset);
    offset += chunk.byteLength;
    copiedSinceYield += chunk.byteLength;
    chunks[index] = null;
    if (copiedSinceYield >= 8 * 1024 * 1024) {
      copiedSinceYield = 0;
      await yieldToBrowser();
    }
  }
  return output;
}

function createWorkerReadableStream(input, source, label) {
  let worker = null;
  let workerUrl = "";
  let cleanup = null;
  return new ReadableStream({
    start(controller) {
      try {
        workerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        worker = new Worker(workerUrl);
      } catch (error) {
        if (workerUrl) URL.revokeObjectURL(workerUrl);
        controller.error(new Error("Could not start the offline " + label + " decompression worker: " + (error.message || String(error))));
        return;
      }

      let closed = false;
      cleanup = () => {
        if (closed) return;
        closed = true;
        worker.terminate();
        if (workerUrl) URL.revokeObjectURL(workerUrl);
      };
      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === "ready") {
          URL.revokeObjectURL(workerUrl);
          workerUrl = "";
        } else if (message.type === "chunk") {
          controller.enqueue(new Uint8Array(message.chunk));
          if (message.done) {
            controller.close();
            cleanup();
          }
        } else if (message.type === "done") {
          controller.close();
          cleanup();
        } else if (message.type === "error") {
          controller.error(new Error(message.message || label + " decompression failed."));
          cleanup();
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        controller.error(new Error("The browser could not run the offline " + label + " decompression worker."));
        cleanup();
      };

      const compressedBuffer = input.byteOffset === 0 && input.byteLength === input.buffer.byteLength
        ? input.buffer
        : input.slice().buffer;
      worker.postMessage({ type: "init", input: compressedBuffer }, [compressedBuffer]);
    },
    pull() {
      if (worker) worker.postMessage({ type: "pull" });
    },
    cancel() {
      if (cleanup) cleanup();
    }
  });
}

function createGzipWorkerSource() {
  return `
let reader = null;
let credits = 0;
let running = false;
let finished = false;
self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === "init") {
    try {
      const compressed = new Blob([message.input]).stream();
      reader = compressed.pipeThrough(new DecompressionStream("gzip")).getReader();
      self.postMessage({ type: "ready" });
      pump();
    } catch (error) {
      fail(error);
    }
  } else if (message.type === "pull") {
    credits += 1;
    pump();
  }
};
async function pump() {
  if (running || finished || !reader || credits === 0) return;
  running = true;
  try {
    while (credits > 0 && !finished) {
      const part = await reader.read();
      if (part.done) {
        finished = true;
        self.postMessage({ type: "done" });
        return;
      }
      if (!part.value || !part.value.byteLength) continue;
      const chunk = part.value.slice();
      credits -= 1;
      self.postMessage({ type: "chunk", chunk: chunk.buffer }, [chunk.buffer]);
    }
  } catch (error) {
    fail(error);
  } finally {
    running = false;
  }
}
function fail(error) {
  if (finished) return;
  finished = true;
  if (reader) reader.cancel().catch(() => {});
  self.postMessage({ type: "error", message: error && error.message ? error.message : String(error) });
}
`;
}

function createXZWorkerStream(input) {
  return createWorkerReadableStream(
    input,
    window.xzwasm.XzReadableStream.createWorkerSource(),
    "XZ"
  );
}

function createGzipWorkerStream(input) {
  return createWorkerReadableStream(input, createGzipWorkerSource(), "GZip");
}

async function inflateXZ(input, reportProgress) {
  if (!window.xzwasm || !window.xzwasm.XzReadableStream ||
      typeof window.xzwasm.XzReadableStream.createWorkerSource !== "function") {
    throw new Error("Offline XZ decompression worker is unavailable.");
  }
  if (reportProgress !== false) setWorkProgress("Inflating XZ archive", 0, 0);
  return readDecompressedStream(createXZWorkerStream(input), "Inflating XZ archive", reportProgress);
}

async function inflateGzip(input, reportProgress) {
  if (typeof Worker !== "function" || typeof DecompressionStream !== "function") {
    throw new Error("This browser does not support offline GZip decompression in a worker.");
  }
  if (reportProgress !== false) setWorkProgress("Inflating GZip archive", 0, 0);
  return readDecompressedStream(createGzipWorkerStream(input), "Inflating GZip archive", reportProgress);
}

async function readGameArchiveEntries(file, options) {
  const opts = options && typeof options === "object" ? options : {};
  const name = String(file && file.name || "").toLowerCase();
  const reportProgress = !(opts.reportProgress === false);
  let bytes = new Uint8Array(await readFileArrayBufferWithProgress(file, "Reading archive", { reportProgress }));
  const hasXzSignature = bytes.length >= 6 &&
    bytes[0] === 0xfd && bytes[1] === 0x37 && bytes[2] === 0x7a &&
    bytes[3] === 0x58 && bytes[4] === 0x5a && bytes[5] === 0x00;
  const hasGzipSignature = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (/\.(?:tar\.xz|txz|xz)$/.test(name) || hasXzSignature) {
    bytes = await inflateXZ(bytes, reportProgress);
  } else if (/\.(?:tar\.gz|tgz)$/.test(name) || hasGzipSignature) {
    bytes = await inflateGzip(bytes, reportProgress);
  }
  const entries = await parseTarArchive(bytes, opts.onEntryPath);
  bytes = null;
  return entries;
}
