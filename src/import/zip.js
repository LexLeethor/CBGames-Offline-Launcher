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
    const chunks = [];
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
      chunks.push(chunk);
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

    const blob = new Blob(chunks, { type: file.type || "application/octet-stream" });
    return blob.arrayBuffer();
  }

function findEocdOffset(bytes) {
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

// Heuristic: file types that are safe to stream/store immediately without rewrites
function isStreamablePath(path) {
    return /\.(?:mp4|webm|ogg|ogv|mov|mkv|png|jpe?g|gif|webp|avif|mp3|wav|flac|m4a)$/i.test(String(path || ""));
}

function createZipStoreArchive(entries) {
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

function replaceBrUrlsInObject(value, brMap) {
    if (!value) {
      return value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/\.br$/i.test(trimmed)) {
        const decoded = trimmed.replace(/\.br$/i, "");
        if (!brMap || !brMap.size || brMap.has(decoded)) {
          return decoded;
        }
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => replaceBrUrlsInObject(item, brMap));
    }
    if (typeof value === "object") {
      const next = {};
      for (const [key, entry] of Object.entries(value)) {
        next[key] = replaceBrUrlsInObject(entry, brMap);
      }
      return next;
    }
    return value;
  }

function buildBrotliReplacementMap(decodedPaths) {
    const map = new Map();
    for (const decoded of decodedPaths) {
      map.set(decoded + ".br", decoded);
    }
    return map;
  }

function replaceBrReferencesInText(text, brMap) {
    if (!text || !brMap || !brMap.size) {
      return text;
    }
    let out = text;
    for (const [brPath, decodedPath] of brMap.entries()) {
      if (out.includes(brPath)) {
        out = out.split(brPath).join(decodedPath);
      }
    }
    return out;
  }

function addReplacementRecord(replacements, original, transformed) {
    if (!original || !transformed || original === transformed) {
      return;
    }
    if (replacements.some((item) => item.original === original && item.transformed === transformed)) {
      return;
    }
    replacements.push({ original, transformed });
  }

function replaceBrReferencesInTextWithRecords(text, brMap, replacements) {
    if (!text || !brMap || !brMap.size) {
      return text;
    }
    let out = text;
    for (const [brPath, decodedPath] of brMap.entries()) {
      if (out.includes(brPath)) {
        out = out.split(brPath).join(decodedPath);
        addReplacementRecord(replacements, brPath, decodedPath);
      }
    }
    return out;
  }

function stripGenericBrotliSuffixes(text) {
    if (!text) {
      return text;
    }
    return text
      .replace(/\.data\.br\b/gi, ".data")
      .replace(/\.wasm\.br\b/gi, ".wasm")
      .replace(/\.framework\.js\.br\b/gi, ".framework.js")
      .replace(/\.js\.br\b/gi, ".js")
      .replace(/\.mjs\.br\b/gi, ".mjs")
      .replace(/\.cjs\.br\b/gi, ".cjs")
      .replace(/\.css\.br\b/gi, ".css")
      .replace(/\.json\.br\b/gi, ".json");
  }

function stripGenericBrotliSuffixesWithRecords(text, replacements) {
    if (!text) {
      return text;
    }
    const patterns = [
      [/\.data\.br\b/gi, ".data"],
      [/\.wasm\.br\b/gi, ".wasm"],
      [/\.framework\.js\.br\b/gi, ".framework.js"],
      [/\.js\.br\b/gi, ".js"],
      [/\.mjs\.br\b/gi, ".mjs"],
      [/\.cjs\.br\b/gi, ".cjs"],
      [/\.css\.br\b/gi, ".css"],
      [/\.json\.br\b/gi, ".json"]
    ];
    let out = text;
    for (const [pattern, replacement] of patterns) {
      out = out.replace(pattern, (match) => {
        addReplacementRecord(replacements, match, replacement);
        return replacement;
      });
    }
    return out;
  }

function replaceBrUrlsInObjectWithRecords(value, brMap, replacements) {
    if (!value) {
      return value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/\.br$/i.test(trimmed)) {
        const decoded = trimmed.replace(/\.br$/i, "");
        if (!brMap || !brMap.size || brMap.has(decoded)) {
          addReplacementRecord(replacements, value, decoded);
          return decoded;
        }
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => replaceBrUrlsInObjectWithRecords(item, brMap, replacements));
    }
    if (typeof value === "object") {
      const next = {};
      for (const [key, entry] of Object.entries(value)) {
        next[key] = replaceBrUrlsInObjectWithRecords(entry, brMap, replacements);
      }
      return next;
    }
    return value;
  }

function pushJsonRewriteTransformation(transformations, replacements, source) {
    if (!replacements.length) {
      return;
    }
    const existing = transformations.find((item) => item.type === "json_rewrite");
    if (existing) {
      existing.replacements = existing.replacements || [];
      for (const replacement of replacements) {
        addReplacementRecord(existing.replacements, replacement.original, replacement.transformed);
      }
      if (source) {
        existing.sources = Array.isArray(existing.sources) ? existing.sources : [];
        if (!existing.sources.includes(source)) {
          existing.sources.push(source);
        }
      }
      return;
    }
    transformations.push({
      version: 1,
      type: "json_rewrite",
      source,
      replacements: replacements.slice()
    });
  }

function buildBrotliDecodedPathSetFromRecords(records) {
    const decodedPaths = new Set();
    for (const record of Array.isArray(records) ? records : []) {
      const path = normalizePath(record && record.path ? record.path : "");
      if (path) {
        decodedPaths.add(path);
      }
      const transformations = Array.isArray(record && record.transformations) ? record.transformations : [];
      for (const transform of transformations) {
        const replacements = Array.isArray(transform && transform.replacements) ? transform.replacements : [];
        for (const replacement of replacements) {
          const transformed = normalizePath(replacement && replacement.transformed ? replacement.transformed : "");
          if (transformed) {
            decodedPaths.add(transformed);
          }
        }
      }
    }
    return decodedPaths;
  }

function applyCurrentExtractorTransformations(path, bytes, context) {
    let entryBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const transformations = [];
    const decodedPaths = context && context.brotliDecodedPaths instanceof Set
      ? context.brotliDecodedPaths
      : new Set();
    const replacementMap = context && context.brotliReplacementMap instanceof Map
      ? context.brotliReplacementMap
      : buildBrotliReplacementMap(decodedPaths);
    const normalizedPath = normalizePath(path || "");
    const isTextFile = /\.(?:html?|js|mjs|cjs|css|json)$/i.test(normalizedPath);

    if (replacementMap.size && isTextFile) {
      try {
        const originalText = decodeUtf8(entryBytes);
        const replacements = [];
        const replacedText = stripGenericBrotliSuffixesWithRecords(
          replaceBrReferencesInTextWithRecords(originalText, replacementMap, replacements),
          replacements
        );
        if (replacedText !== originalText) {
          entryBytes = new TextEncoder().encode(replacedText);
          pushJsonRewriteTransformation(transformations, replacements, "text_brotli_reference");
        }
      } catch {
        // ignore decode failures
      }
    }

    if (decodedPaths.size && /\.json$/i.test(normalizedPath)) {
      try {
        const jsonText = decodeUtf8(entryBytes);
        const jsonValue = JSON.parse(jsonText);
        const replacements = [];
        const rewritten = replaceBrUrlsInObjectWithRecords(jsonValue, decodedPaths, replacements);
        const rewrittenText = JSON.stringify(rewritten);
        if (rewrittenText !== jsonText) {
          entryBytes = new TextEncoder().encode(rewrittenText);
          pushJsonRewriteTransformation(transformations, replacements, "json_brotli_url");
        }
      } catch {
        // ignore JSON rewrite failures
      }
    }

    return {
      bytes: entryBytes,
      transformations: transformations.length ? transformations : undefined
    };
  }

async function extractEntryBytes(zip, entry) {
    if (entry.flags & 0x1) {
      throw new Error("Encrypted ZIP entries are not supported: " + entry.path);
    }

    const compressed = getCompressedEntrySlice(zip, entry);

    if (entry.compressionMethod === 0) {
      return compressed.slice();
    }
    if (entry.compressionMethod === 8) {
      const decompressed = await inflateDeflateRaw(compressed);
      return decompressed;
    }

    throw new Error(
      "Unsupported ZIP compression method " + entry.compressionMethod + " for " + entry.path
    );
  }

async function pickZipFile() {
    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: false,
          types: [
            {
              description: "ZIP archives",
              accept: {
                "application/zip": [".zip"],
                "application/x-zip-compressed": [".zip"]
              }
            }
          ]
        });
        if (!handles.length) {
          return;
        }
        const file = await handles[0].getFile();
        await importZipFile(file);
      } catch (error) {
        if (error && error.name === "AbortError") {
          log("ZIP import canceled.");
          return;
        }
        console.error(error);
        log("Import failed: " + (error.message || String(error)), "error");
      }
      return;
    }

    zipInput.value = "";
    zipInput.click();
  }

async function pickReplaceZipForGameId(gameId) {
    const selected = gameId ? state.gamesById.get(gameId) : null;
    if (!selected) {
      log("Choose a valid game to replace.", "error");
      return;
    }

    const importSelectedFile = async (file) => {
      if (!file) {
        return;
      }
      await importZipFile(file, {
        importMode: "replace",
        replaceGameId: selected.id
      });
    };

    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: false,
          types: [
            {
              description: "ZIP archives",
              accept: {
                "application/zip": [".zip"],
                "application/x-zip-compressed": [".zip"]
              }
            }
          ]
        });
        if (!handles.length) {
          return;
        }
        const file = await handles[0].getFile();
        await importSelectedFile(file);
      } catch (error) {
        if (error && error.name === "AbortError") {
          log("Replace import canceled.");
          return;
        }
        console.error(error);
        log("Replace import failed: " + (error.message || String(error)), "error");
      }
      return;
    }

    replaceZipInput.value = "";
    replaceZipInput.dataset.replaceGameId = selected.id;
    replaceZipInput.click();
  }

function replaceGameWithZipFlow() {
    if (!state.gamesById.size) {
      log("No games available to replace yet.", "error");
      return;
    }
    openReplaceTargetGameModal();
  }

async function applyPreLaunchTransformations(entries) {
    if (!entries || !entries.length) return;

    const recordsByPath = new Map(entries.map(e => [e.path, {
      path: e.path,
      bytes: e.bytes,
      get blob() {
        return new Blob([this.bytes], { type: mimeFromPath(this.path) });
      }
    }]));
    const dataUrlCache = new Map();

    // 1. Collect worker paths (needs to scan JS files)
    const workerPaths = await collectWorkerScriptPaths(recordsByPath);

    // 2. Apply transformations
    for (const entry of entries) {
      const path = entry.path;
      const bytes = entry.bytes;
      let text = null;
      let changed = false;
      const transformations = entry.transformations || [];

      // Unity Web Config rewrite
      if (/\.json$/i.test(path)) {
        try {
          text = text || decodeUtf8(bytes);
          const { text: rewritten, changed: jsonChanged } = rewriteUnityWebConfigText(text, path);
          if (jsonChanged) {
            const replacements = [{ original: text, replacement: rewritten }];
            pushJsonRewriteTransformation(transformations, replacements, "unity_config_rewrite");
            text = rewritten;
            changed = true;
          }
        } catch (e) { /* ignore */ }
      }

      // JS / UnityWeb patching
      if (/\.(?:js|mjs|cjs|unityweb)$/i.test(path)) {
        try {
          text = text || decodeUtf8(bytes);
          let jsChanged = false;

          // Emscripten WASM inlining (mostly for workers)
          if (workerPaths.has(path)) {
            const patched = await patchEmscriptenWasmScriptText(text, path, recordsByPath, dataUrlCache);
            if (patched !== text) {
              text = patched;
              jsChanged = true;
            }
          }

          // importScripts inlining
          const rewrittenImport = await rewriteImportScriptsText(text, path, recordsByPath, dataUrlCache);
          if (rewrittenImport !== text) {
            text = rewrittenImport;
            jsChanged = true;
          }

          // Static patches (baseURI, GetDocumentURL)
          const staticPatched = applyStaticJsPatches(text, path);
          if (staticPatched !== text) {
            text = staticPatched;
            jsChanged = true;
          }

          // Dynamic import() patching
          if (!/^Build\//i.test(path)) {
            const dynamicPatched = await patchDynamicImportsInText(text, path, recordsByPath, dataUrlCache);
            if (dynamicPatched !== text) {
              text = dynamicPatched;
              jsChanged = true;
            }
          }

          if (jsChanged) {
            changed = true;
            // For now, we don't record complex JS transformations in transformations array 
            // because they are hard to revert perfectly with literal replacements.
            // But we still apply them for launch speed.
          }
        } catch (e) { /* ignore */ }
      }

      if (changed && text !== null) {
        entry.bytes = encodeUtf8(text);
        entry.transformations = transformations.length ? transformations : undefined;
      }
    }
  }

async function importZipFile(file, options) {
    const opts = options && typeof options === "object" ? options : {};
    const requestedMode = opts.importMode === "replace" || opts.importMode === "separate"
      ? opts.importMode
      : "";
    const replaceGameId = typeof opts.replaceGameId === "string" ? opts.replaceGameId : "";
    const incomingGithubSource = normalizeGithubSource(opts.githubSource);
    const manageUi = opts.manageUi !== false;
    if (!file) {
      return;
    }
    if (!/\.zip$/i.test(file.name)) {
      log("Please choose a .zip file.", "error");
      return;
    }
    if (typeof onTutorialZipImportStarted === "function") {
      onTutorialZipImportStarted();
    }
    const existingGame = replaceGameId && state.gamesById.has(replaceGameId)
      ? state.gamesById.get(replaceGameId)
      : findExistingGameMatchForImport(file.name);
    let importMode = "separate";
    if (requestedMode) {
      importMode = requestedMode === "replace" && existingGame ? "replace" : "separate";
    } else if (existingGame) {
      importMode = await askImportConflictDecision(existingGame, file.name);
      if (!importMode || importMode === "cancel") {
        log("Import canceled.");
        return;
      }
      if (importMode === "optionA") importMode = "separate";
      if (importMode === "optionB") importMode = "replace";
    }
    if (manageUi) {
      setActionButtonsDisabled(true);
    }
    const gameId = importMode === "replace" && existingGame ? existingGame.id : makeId();
    const preservedThumbnail = importMode === "replace" && existingGame
      ? (typeof existingGame.thumbnailDataUrl === "string" ? existingGame.thumbnailDataUrl : "")
      : "";
    const preservedName = importMode === "replace" && existingGame
      ? String(existingGame.name || deriveGameName(file.name))
      : deriveGameName(file.name);
    const preservedSortOrder = importMode === "replace" && existingGame
      ? Number(existingGame.sortOrder)
      : Number.MAX_SAFE_INTEGER;
    const resolvedGithubSource = incomingGithubSource || (
      importMode === "replace" && existingGame ? normalizeGithubSource(existingGame.githubSource) : null
    );

    try {
      setWorkProgress("Reading ZIP", 0, 0);
      log("Reading ZIP: " + file.name);
      const zipBuffer = await file.arrayBuffer();
      const zip = parseZipArchive(zipBuffer);

      if (!zip.entries.length) {
        throw new Error("ZIP contains no importable files.");
      }

      const entryPaths = new Set(zip.entries.map((e) => normalizePath(e.path)));
      if (entryPaths.has("bundle.json")) {
        throw new Error("This looks like a Bundle ZIP. Use 'Import Bundle' to import it.");
      }
      if (entryPaths.has("manifest.json")) {
        const mEntry = zip.entries.find((e) => normalizePath(e.path) === "manifest.json");
        if (mEntry) {
          try {
            const mBytes = await extractEntryBytes(zip, mEntry);
            const mData = JSON.parse(new TextDecoder().decode(mBytes));
            if (mData && (mData.version === "cbgames-save-v1" || mData.version === "cbgames-save-v2")) {
              throw new Error("This looks like a Save Data ZIP. Use 'Import Saves' to import it.");
            }
          } catch (e) {
            if (e.message && e.message.startsWith("This looks like")) throw e;
          }
        }
      }

      const processedEntries = [];
      const brotliDecodedPaths = new Set();
      const seenPaths = new Map();
      for (const entry of zip.entries) {
        const entryBytes = await extractEntryBytes(zip, entry);
        let path = entry.path;
        let bytes = entryBytes;
        let brotliDecoded = false;
        if (/\.br$/i.test(path)) {
          try {
            bytes = await inflateBrotli(entryBytes);
            path = path.replace(/\.br$/i, "");
            brotliDecodedPaths.add(path);
            brotliDecoded = true;
          } catch (error) {
            console.error(error);
            log("Brotli decode failed for " + entry.path + ". Keeping compressed version.", "error");
          }
        }
        if (seenPaths.has(path)) {
          const existingIndex = seenPaths.get(path);
          if (brotliDecoded && typeof existingIndex === "number") {
            processedEntries[existingIndex] = {
              path,
              bytes,
              originalPath: entry.path
            };
          }
          continue;
        }
        seenPaths.set(path, processedEntries.length);
        processedEntries.push({
          path,
          bytes,
          originalPath: entry.path
        });
      }

      const brotliReplacementMap = buildBrotliReplacementMap(brotliDecodedPaths);

      setWorkProgress("Optimizing game assets", 0, 0);
      for (const entry of processedEntries) {
        const transformed = applyCurrentExtractorTransformations(entry.path, entry.bytes, {
          brotliDecodedPaths,
          brotliReplacementMap
        });
        entry.bytes = transformed.bytes;
        entry.transformations = transformed.transformations;
      }

      await applyPreLaunchTransformations(processedEntries);

      const htmlEntries = processedEntries
        .map((entry) => entry.path)
        .filter((path) => /\.html?$/i.test(path))
        .sort((a, b) => a.localeCompare(b));

      // Check for SharedArrayBuffer usage (known limitation)
      if (detectSharedArrayBufferUsage(processedEntries)) {
        const sabDecision = await askSharedArrayBufferDecision();
        if (sabDecision !== "optionB") {
          log("Import canceled (SharedArrayBuffer).");
          return;
        }
        log("Importing despite SharedArrayBuffer. The game may not work on file://.");
      }

      const gameRecord = {
        id: gameId,
        name: preservedName,
        zipName: file.name,
        importedAt: Date.now(),
        extractorVersion: CURRENT_EXTRACTOR_VERSION,
        sortOrder: Number.isFinite(preservedSortOrder) ? preservedSortOrder : getNextSortOrder(),
        fileCount: processedEntries.length,
        totalBytes: 0,
        htmlEntries,
        entryPath: chooseBestEntryPath(htmlEntries, ""),
        thumbnailDataUrl: preservedThumbnail,
        githubSource: resolvedGithubSource,
        unityDetected: detectUnityByPaths(processedEntries.map((entry) => entry.path)),
        flashDetected: detectFlashByPaths(processedEntries.map((entry) => entry.path))
      };
      if (importMode === "replace" && existingGame) {
        await deleteFilesByGameId(existingGame.id);
        log("Replacing existing game: " + (existingGame.name || existingGame.id));
      }

      let processed = 0;
      let totalBytes = 0;
      setWorkProgress("Importing game files", 0, processedEntries.length);

      for (const entry of processedEntries) {
        const entryBytes = entry.bytes;
        const transformations = entry.transformations;

        const blob = new Blob([entryBytes], { type: mimeFromPath(entry.path) });
        totalBytes += blob.size;

        await putFileRecord({
          gameId,
          path: entry.path,
          size: blob.size,
          type: blob.type,
          blob,
          transformations
        });

        if (!gameRecord.unityDetected && /\.html?$/i.test(entry.path)) {
          try {
            const htmlText = decodeUtf8(entryBytes);
            if (detectUnityByHtmlText(htmlText)) {
              gameRecord.unityDetected = true;
            }
          } catch {
            // ignore decode errors
          }
        }

        processed += 1;
        if (processed % 20 === 0 || processed === processedEntries.length) {
          setWorkProgress("Importing game files", processed, processedEntries.length);
        }
        if (processed % 40 === 0 || processed === processedEntries.length) {
          log("Imported " + processed + "/" + processedEntries.length + " files...");
        }
      }

      gameRecord.totalBytes = totalBytes;
      await putGame(gameRecord);
      state.selectedGameId = gameId;
      await putSetting(SETTING_SELECTED_GAME, gameId);

      await loadLibrary(gameId);
      if (importMode === "replace" && existingGame) {
        log("Replaced game \"" + (existingGame.name || gameRecord.name) + "\" (" + formatBytes(totalBytes) + ")");
      } else {
        log("Saved game \"" + gameRecord.name + "\" (" + formatBytes(totalBytes) + ")");
        openGameEditModal(gameId);
      }
    } catch (error) {
      console.error(error);
      const msg = error.message || String(error);
      if (isQuotaExceededError(error)) {
        const quotaMsg = "Storage Quota Exceeded: Your browser storage is full. Please delete some existing games or free up browser disk space before importing this game.";
        log("Import failed: Storage quota exceeded.", "error");
        openWrongZipTypeModal(quotaMsg, "Storage Quota Exceeded");
        try {
          if (importMode !== "replace") {
            await deleteFilesByGameId(gameId);
            await deleteGameRecord(gameId);
          }
        } catch {
          // best effort cleanup
        }
      } else if (msg.startsWith("This looks like")) {
        openWrongZipTypeModal(msg, "Wrong ZIP Type");
      } else {
        log("Import failed: " + msg, "error");
        try {
          if (importMode !== "replace") {
            await deleteFilesByGameId(gameId);
            await deleteGameRecord(gameId);
          }
        } catch {
          // best effort cleanup
        }
      }
    } finally {
      if (manageUi) {
        setActionButtonsDisabled(false);
        clearWorkProgress();
      }
    }
  }

async function importFromGithub() {
    const input = await askGithubImportSource();
    if (!input) {
      log("GitHub import canceled.");
      return;
    }
    const repoRef = parseGithubRepoRef(input);
    const directUrl = toHttpUrl(input);
    setActionButtonsDisabled(true);
    try {
      let sourceMeta = null;
      let downloadUrl = "";
      if (repoRef) {
        setWorkProgress("Checking GitHub release", 0, 0);
        let releaseMeta = null;
        let releaseError = null;
        try {
          releaseMeta = await fetchLatestGithubReleaseInfo(repoRef.owner, repoRef.repo, "");
        } catch (error) {
          releaseError = error;
          const message = String(error && error.message ? error.message : error);
          const noRelease = /No latest release found|\/releases\/latest|no \.zip asset/i.test(message);
          if (!noRelease) {
            // API itself failed — still try the file-tree path below.
            log("GitHub release lookup failed; trying api.github.com file tree...");
          }
        }

        if (releaseMeta) {
          try {
            const download = await downloadGithubReleaseZip(releaseMeta, "Downloading ZIP");
            sourceMeta = {
              ...releaseMeta,
              etag: download.etag,
              lastModified: download.lastModified,
              lastCheckedAt: Date.now()
            };
            await importZipFile(download.file, {
              githubSource: sourceMeta,
              manageUi: false
            });
            log("Imported from GitHub source.");
            return;
          } catch (error) {
            console.error(error);
            log(
              "Release ZIP download failed (" +
              (error.message || String(error)) +
              "). Falling back to GitHub repo ZIP..."
            );
          }
        } else if (releaseError) {
          const message = String(releaseError && releaseError.message ? releaseError.message : releaseError);
          if (!/No latest release found|\/releases\/latest|no \.zip asset/i.test(message)) {
            // keep going to tree fallback
          } else {
            setWorkProgress("No release found, reading repo metadata", 0, 0);
          }
        }

        setWorkProgress("Reading GitHub repo metadata", 0, 0);
        const snapshot = await fetchGithubRepoTreeSnapshot(repoRef.owner, repoRef.repo, "");
        sourceMeta = {
          provider: "github-tree",
          owner: snapshot.owner,
          repo: snapshot.repo,
          branch: snapshot.branch,
          treeSha: snapshot.treeSha,
          lastCheckedAt: Date.now()
        };
        await importGithubTreeDirect(snapshot, (String(snapshot.repo || "github-repo") + " (" + String(snapshot.branch || "main") + ")"), {
          streamDuringDownload: true,
          prioritizeSmallest: true,
          skipPatterns: [],
          manageUi: false,
          githubSource: sourceMeta
        });
        log("Imported from GitHub source.");
        return;
      } else if (directUrl && /\.zip(?:$|[?#])/i.test(directUrl)) {
        sourceMeta = {
          provider: "zip-url",
          url: directUrl,
          etag: "",
          lastModified: "",
          lastCheckedAt: Date.now()
        };
        downloadUrl = directUrl;
      } else {
        throw new Error("Input must be a GitHub repo or a .zip URL.");
      }
      const download = await downloadZipFromUrl(downloadUrl, "Downloading ZIP");
      sourceMeta.url = download.resolvedUrl || sourceMeta.url;
      sourceMeta.etag = download.etag;
      sourceMeta.lastModified = download.lastModified;
      sourceMeta.lastCheckedAt = Date.now();
      await importZipFile(download.file, {
        githubSource: sourceMeta,
        manageUi: false
      });
      log("Imported from GitHub source.");
    } finally {
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }
  }

async function checkAllGithubUpdates() {
    const candidates = sortedGames().filter((game) => normalizeGithubSource(game.githubSource));
    if (!candidates.length) {
      log("No GitHub-linked games found in your library.", "error");
      setUpdateScanStatus("No GitHub-linked games found.");
      return;
    }

    let updatedCount = 0;
    let availableCount = 0;
    let noUpdateCount = 0;
    let stoppedByUser = false;

    setActionButtonsDisabled(true);
    try {
      setUpdateScanStatus("Checking " + candidates.length + " GitHub-linked game(s)...");
      for (let i = 0; i < candidates.length; i += 1) {
        const selected = candidates[i];
        const source = normalizeGithubSource(selected.githubSource);
        if (!source) {
          continue;
        }

        setWorkProgress("Checking updates (" + (i + 1) + "/" + candidates.length + ")", i + 1, candidates.length);

        let updateAvailable = false;
        let nextSource = source;
        let sourceLabel = "";

        if (source.provider === "github-release") {
          const latest = await fetchLatestGithubReleaseInfo(source.owner, source.repo, source.assetName);
          latest.etag = source.etag || "";
          latest.lastModified = source.lastModified || "";
          updateAvailable = githubReleaseHasUpdate(source, latest);
          nextSource = latest;
          sourceLabel = latest.releaseTag || latest.assetName || "latest release";
        } else if (source.provider === "zip-url") {
          let headInfo = null;
          try {
            headInfo = await fetchZipHeadInfo(source.url);
          } catch {
            headInfo = null;
          }
          if (headInfo) {
            updateAvailable = zipUrlHasUpdate(source, headInfo);
            nextSource = normalizeGithubSource({
              ...source,
              url: headInfo.url || source.url,
              etag: headInfo.etag || source.etag,
              lastModified: headInfo.lastModified || source.lastModified,
              lastCheckedAt: Date.now()
            }) || source;
          }
          sourceLabel = source.url;
        } else if (source.provider === "github-tree") {
          const latestTree = await fetchGithubRepoTreeSnapshot(source.owner, source.repo, source.branch);
          updateAvailable = latestTree.treeSha !== source.treeSha;
          nextSource = normalizeGithubSource({
            provider: "github-tree",
            owner: latestTree.owner,
            repo: latestTree.repo,
            branch: latestTree.branch,
            treeSha: latestTree.treeSha,
            lastCheckedAt: Date.now()
          }) || source;
          sourceLabel = source.owner + "/" + source.repo + "@" + latestTree.branch;
        }

        if (!updateAvailable) {
          noUpdateCount += 1;
          nextSource.lastCheckedAt = Date.now();
          selected.githubSource = nextSource;
          state.gamesById.set(selected.id, selected);
          await putGame(selected);
          continue;
        }

        availableCount += 1;
        const decision = await askUpdateInstallDecision(
          selected.name || "Selected game",
          sourceLabel,
          "Update " + (availableCount) + " found while checking " + (i + 1) + "/" + candidates.length + " games."
        );
        if (decision === "stop") {
          stoppedByUser = true;
          break;
        }
        if (decision !== "update") {
          log("Skipped update for \"" + (selected.name || selected.id) + "\".");
          continue;
        }

        if (source.provider === "github-tree") {
          const latestTree = await fetchGithubRepoTreeSnapshot(source.owner, source.repo, source.branch);
          const mergedSource = normalizeGithubSource({
            provider: "github-tree",
            owner: latestTree.owner,
            repo: latestTree.repo,
            branch: latestTree.branch,
            treeSha: latestTree.treeSha,
            lastCheckedAt: Date.now()
          });
          await importGithubTreeDirect(latestTree, selected.name || (String(latestTree.repo || "github-repo") + " (" + String(latestTree.branch || "main") + ")"), {
            streamDuringDownload: true,
            prioritizeSmallest: true,
            replaceGameId: selected.id,
            importMode: "replace",
            githubSource: mergedSource,
            manageUi: false
          });
        } else {
          const downloadUrl = source.provider === "github-release"
            ? String(nextSource.downloadUrl || source.downloadUrl || "")
            : String(source.url || "");
          let download = null;
          if (source.provider === "github-release") {
            try {
              download = await downloadGithubReleaseZip(nextSource, "Downloading update");
            } catch (error) {
              console.error(error);
              log(
                "Release ZIP download failed; falling back to GitHub repo ZIP for \"" +
                (selected.name || selected.id) + "\"..."
              );
              const latestTree = await fetchGithubRepoTreeSnapshot(source.owner, source.repo, "");
              const treeSource = normalizeGithubSource({
                provider: "github-tree",
                owner: latestTree.owner,
                repo: latestTree.repo,
                branch: latestTree.branch,
                treeSha: latestTree.treeSha,
                lastCheckedAt: Date.now()
              });
              await importGithubTreeDirect(latestTree, selected.name || (String(latestTree.repo || "github-repo") + " (" + String(latestTree.branch || "main") + ")"), {
                streamDuringDownload: true,
                prioritizeSmallest: true,
                replaceGameId: selected.id,
                importMode: "replace",
                githubSource: treeSource,
                manageUi: false
              });
              updatedCount += 1;
              log("Updated \"" + (selected.name || selected.id) + "\".");
              continue;
            }
          } else {
            download = await downloadZipFromUrl(downloadUrl, "Downloading update");
          }
          const mergedSource = normalizeGithubSource(
            source.provider === "github-release"
              ? {
                  ...nextSource,
                  etag: download.etag || nextSource.etag,
                  lastModified: download.lastModified || nextSource.lastModified,
                  lastCheckedAt: Date.now()
                }
              : {
                  ...nextSource,
                  url: download.resolvedUrl || source.url,
                  etag: download.etag || nextSource.etag,
                  lastModified: download.lastModified || nextSource.lastModified,
                  lastCheckedAt: Date.now()
                }
          );
          await importZipFile(download.file, {
            importMode: "replace",
            replaceGameId: selected.id,
            githubSource: mergedSource,
            manageUi: false
          });
        }
        updatedCount += 1;
        log("Updated \"" + (selected.name || selected.id) + "\".");
      }

      log(
        "GitHub update check complete. " +
        updatedCount + " updated, " +
        noUpdateCount + " already up to date, " +
        Math.max(0, availableCount - updatedCount) + " updates skipped." +
        (stoppedByUser ? " Stopped early." : "")
      );
      if (availableCount === 0) {
        setUpdateScanStatus("All checked games are already up to date.");
      } else {
        setUpdateScanStatus(
          updatedCount + " updated, " +
          Math.max(0, availableCount - updatedCount) + " skipped, " +
          noUpdateCount + " already up to date" +
          (stoppedByUser ? " (stopped early)." : ".")
        );
      }
    } finally {
      const updateResolver = closeUpdatePromptModal();
      if (updateResolver) {
        updateResolver("stop");
      }
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }
  }

async function detectDroppedZipKind(file) {
    if (!isZipLikeFile(file)) {
      return "not-zip";
    }

    let parsedZip;
    try {
      const buffer = await file.arrayBuffer();
      parsedZip = parseZipArchive(buffer);
    } catch {
      return "invalid-zip";
    }

    const entryByPath = new Map(parsedZip.entries.map((entry) => [normalizePath(entry.path), entry]));
    const manifestEntry = entryByPath.get("bundle.json");
    if (!manifestEntry) {
      return "game";
    }

    try {
      const bytes = await extractEntryBytes(parsedZip, manifestEntry);
      const parsed = JSON.parse(decodeUtf8(bytes));
      if (parsed && parsed.format === "cbgames-zip-v2" && Array.isArray(parsed.games)) {
        return "bundle";
      }
    } catch {
      // treat malformed bundle marker as regular game ZIP
    }

    return "game";
  }

async function handleDroppedZipFiles(fileList) {
    const files = Array.from(fileList || []);
    const zipFiles = files.filter((file) => isZipLikeFile(file));
    if (!zipFiles.length) {
      log("Drop one or more .zip files.", "error");
      return;
    }

    for (const file of zipFiles) {
      try {
        setDragDropOverlay(true, "Inspecting " + file.name + "...");
        const kind = await detectDroppedZipKind(file);
        setDragDropOverlay(false);

        if (kind === "not-zip") {
          log("Skipped non-zip file: " + file.name, "error");
          continue;
        }
        if (kind === "invalid-zip") {
          log("Could not read ZIP: " + file.name, "error");
          continue;
        }

        if (kind === "bundle") {
          log("Detected bundle ZIP: " + file.name);
          await importBundleFile(file);
        } else {
          log("Detected game ZIP: " + file.name);
          await importZipFile(file);
        }
      } catch (error) {
        console.error(error);
        log("Drop import failed for " + file.name + ": " + (error.message || String(error)), "error");
      } finally {
        setDragDropOverlay(false);
      }
    }
  }

async function fetchLatestGithubReleaseInfo(owner, repo, preferredAssetName) {
    const apiUrl = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/releases/latest";
    const response = await fetch(apiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json"
      }
    });
    if (!response.ok) {
      const extra = response.status === 404 ? " No latest release found for this repo." : "";
      throw new Error("GitHub release lookup failed (" + response.status + ")." + extra);
    }
    const release = await response.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const preferredName = String(preferredAssetName || "").trim();
    let asset = null;
    if (preferredName) {
      asset = assets.find((entry) => String(entry && entry.name || "") === preferredName) || null;
    }
    if (!asset) {
      asset = assets.find((entry) => /\.zip$/i.test(String(entry && entry.name || ""))) || null;
    }
    if (!asset || !asset.browser_download_url) {
      throw new Error("Latest release has no .zip asset.");
    }
    const downloadUrl = toHttpUrl(asset.browser_download_url);
    if (!downloadUrl) {
      throw new Error("Latest release ZIP URL is invalid.");
    }
    return {
      provider: "github-release",
      owner,
      repo,
      releaseTag: String(release.tag_name || ""),
      releaseId: Number(release.id) || 0,
      assetId: Number(asset.id) || 0,
      assetName: String(asset.name || ""),
      assetUpdatedAt: Number(Date.parse(asset.updated_at || "")) || 0,
      downloadUrl,
      etag: "",
      lastModified: "",
      lastCheckedAt: Date.now()
    };
  }

async function fetchGithubRepoTreeSnapshot(owner, repo, branchHint) {
    const branchCandidate = String(branchHint || "").trim();
    let branch = branchCandidate;
    if (!branch) {
      const repoApiUrl = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
      const repoResponse = await fetch(repoApiUrl, {
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json"
        }
      });
      const repoRateLimitErr = checkGithubResponseRateLimit(repoResponse);
      if (repoRateLimitErr) {
        throw repoRateLimitErr;
      }
      if (!repoResponse.ok) {
        throw new Error("GitHub repo lookup failed (" + repoResponse.status + ").");
      }
      const repoInfo = await repoResponse.json();
      branch = String(repoInfo.default_branch || "").trim();
      if (!branch) {
        throw new Error("Could not determine repo default branch.");
      }
    }
    const treeApiUrl =
      "https://api.github.com/repos/" +
      encodeURIComponent(owner) + "/" +
      encodeURIComponent(repo) +
      "/git/trees/" + encodeURIComponent(branch) + "?recursive=1";
    const treeResponse = await fetch(treeApiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json"
      }
    });
    const treeRateLimitErr = checkGithubResponseRateLimit(treeResponse);
    if (treeRateLimitErr) {
      throw treeRateLimitErr;
    }
    if (!treeResponse.ok) {
      throw new Error("GitHub tree lookup failed (" + treeResponse.status + ").");
    }
    const tree = await treeResponse.json();
    const treeSha = String(tree.sha || "").trim();
    const rawEntries = Array.isArray(tree.tree) ? tree.tree : [];
    const fileEntries = rawEntries
      .filter((entry) => entry && entry.type === "blob" && typeof entry.path === "string" && entry.path)
      .map((entry) => {
        const sha = String(entry.sha || "").trim();
        const apiBlobUrl = sha
          ? (
              "https://api.github.com/repos/" +
              encodeURIComponent(owner) + "/" +
              encodeURIComponent(repo) +
              "/git/blobs/" +
              encodeURIComponent(sha)
            )
          : "";
        return {
          path: normalizePath(entry.path),
          url: toHttpUrl(entry.url || "") || toHttpUrl(apiBlobUrl),
          sha,
          size: Number(entry.size) || 0
        };
      })
      .filter((entry) => entry.path && entry.url);
    if (!treeSha) {
      throw new Error("GitHub tree response missing SHA.");
    }
    if (!fileEntries.length) {
      throw new Error("Repository has no file blobs to import.");
    }
    return {
      owner,
      repo,
      branch,
      treeSha,
      fileEntries
    };
  }

async function buildZipFileFromGithubTree(snapshot, labelPrefix) {
    const entries = await downloadGithubTreeEntries(snapshot, labelPrefix);
    const zipBlob = createZipStoreArchive(entries);
    const fileName = String(snapshot.repo || "github-repo") + "-" + String(snapshot.branch || "branch") + ".zip";
    return new File([zipBlob], fileName, { type: "application/zip" });
  }

async function downloadGithubTreeEntries(snapshot, labelPrefix) {
  // third arg may be a function or an options object:
  // downloadGithubTreeEntries(snapshot, label, onFile)
  // or downloadGithubTreeEntries(snapshot, label, { onFile, prioritizeSmallest, skipPatterns })
  const third = arguments.length >= 3 ? arguments[2] : null;
  let onFile = null;
  let prioritizeSmallest = false;
  let skipPatterns = [];
  if (typeof third === 'function') {
    onFile = third;
  } else if (third && typeof third === 'object') {
    onFile = typeof third.onFile === 'function' ? third.onFile : null;
    prioritizeSmallest = !!third.prioritizeSmallest;
    skipPatterns = Array.isArray(third.skipPatterns) ? third.skipPatterns.slice() : [];
  }

  const entries = [];
  const filesOrig = Array.isArray(snapshot && snapshot.fileEntries) ? snapshot.fileEntries.slice() : [];
  const owner = String(snapshot && snapshot.owner || "").trim();
  const repo = String(snapshot && snapshot.repo || "").trim();
  const branch = String(snapshot && snapshot.branch || "").trim();
  const progressLabel = String(labelPrefix || "Downloading repo files");

  const defaultSkipNames = {".gitignore": true, ".gitattributes": true, ".gitmodules": true};
  const shouldSkip = (p) => {
    const parts = String(p || "").split('/');
    const base = parts[parts.length - 1] || "";
    if (defaultSkipNames[base]) return true;
    for (const pat of skipPatterns) {
      try {
        const re = (pat instanceof RegExp) ? pat : new RegExp(pat);
        if (re.test(p)) return true;
      } catch (e) {}
    }
    return false;
  };

  let files = filesOrig.filter(f => !shouldSkip(f.path));
  if (prioritizeSmallest) {
    const INF = Number.MAX_SAFE_INTEGER;
    files.sort((a, b) => {
      const as = Number.isFinite(Number(a && a.size)) ? Number(a.size) : INF;
      const bs = Number.isFinite(Number(b && b.size)) ? Number(b.size) : INF;
      return as - bs;
    });
  }

  const hasKnownSizes = files.every((file) => Number.isFinite(file && file.size) && Number(file.size) >= 0);
  let totalBytes = hasKnownSizes
    ? files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
    : 0;
  let downloadedBytes = 0;
  const ensureTotalAtLeast = (value) => {
    const actual = Number(value || 0);
    if (actual > 0 && actual > totalBytes) {
      totalBytes = actual;
    }
  };
  const adjustTotalForActualSize = (actualLength, pointerLength) => {
    const actual = Number(actualLength || 0);
    const pointer = Number(pointerLength || 0);
    const delta = actual - pointer;
    if (delta > 0 && totalBytes > 0) {
      totalBytes += delta;
    }
    ensureTotalAtLeast(downloadedBytes + actual);
  };
  const updateProgress = (fileIndex) => {
    const fileSuffix = files.length > 0
      ? " (" + (fileIndex + 1) + "/" + files.length + ")"
      : "";
    if (totalBytes > 0) {
      setWorkProgress(
        progressLabel + fileSuffix,
        downloadedBytes,
        totalBytes,
        {
          currentText: formatBytes(downloadedBytes),
          totalText: formatBytes(totalBytes)
        }
      );
    } else {
      setWorkProgress(progressLabel + fileSuffix + " (" + formatBytes(downloadedBytes) + ")", 0, 0);
    }
  };
  updateProgress(0);
  setWorkProgressTree(0, files.length, "", files.map(function(f) { return f.path; }));

    const fetchBytesStreaming = async (fileMeta, fileIndex) => {
      const rawUrl = owner && repo && branch
        ? "https://raw.githubusercontent.com/" +
          encodeURIComponent(owner) + "/" +
          encodeURIComponent(repo) + "/" +
          encodeURIComponent(branch) + "/" +
          fileMeta.path.split("/").map(encodeURIComponent).join("/")
        : "";

      if (!rawUrl) {
        throw new Error("Cannot build raw URL for " + fileMeta.path);
      }

      const streamResponseToUint8Array = async (response, fileIndex) => {
        if (!response || !response.body || typeof response.body.getReader !== "function") {
          const buf = await response.arrayBuffer();
          const bytes = new Uint8Array(buf);
          downloadedBytes += bytes.length;
          updateProgress(fileIndex);
          return bytes;
        }
        const reader = response.body.getReader();
        const chunks = [];
        let totalLength = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            totalLength += value.byteLength;
            downloadedBytes += value.byteLength;
            updateProgress(fileIndex);
          }
        }
        const out = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          out.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return out;
      };

      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          // Try GitHub API blob endpoint first (CORS-friendly) to detect LFS pointers
          if (fileMeta && fileMeta.sha) {
            try {
              const blobApi =
                "https://api.github.com/repos/" + encodeURIComponent(owner) + 
                "/" + encodeURIComponent(repo) + 
                "/git/blobs/" + encodeURIComponent(fileMeta.sha);
              const blobResp = await fetch(blobApi, { cache: "no-store", headers: { Accept: "application/vnd.github+json" } });
              if (blobResp && blobResp.ok) {
                const blobJson = await blobResp.json();
                const b64 = String(blobJson.content || "").replace(/\n/g, "");
                if (b64) {
                  try {
                    const decoded = typeof atob === "function" ? atob(b64) : (new TextDecoder().decode(Uint8Array.from(atob(b64), c=>c.charCodeAt(0))));
                    if (decoded && decoded.startsWith("version https://git-lfs.github.com/spec/v1")) {
                      const oidMatch = decoded.match(/oid sha256:([a-f0-9]{64})/i);
                      const sizeMatch = decoded.match(/size (\d+)/i);
                      const oid = oidMatch ? oidMatch[1] : "";
                      const size = sizeMatch ? Number(sizeMatch[1]) : (fileMeta.size || 0);
                      console.info("LFS: pointer detected via api.github.com for", fileMeta.path, { oid, size });

                      // Try media.githubusercontent.com as a pragmatic fallback — some media URLs serve the real object
                      try {
                        const mediaUrl = owner && repo && branch
                          ? "https://media.githubusercontent.com/media/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + encodeURIComponent(branch) + "/" + fileMeta.path.split("/").map(encodeURIComponent).join("/")
                          : null;
                        if (mediaUrl) {
                          console.debug("LFS: attempting media.githubusercontent.com fallback", mediaUrl);
                          const mediaResp = await fetch(mediaUrl, { cache: "no-store", redirect: "follow" });
                          if (mediaResp && mediaResp.ok) {
                            const mediaLength = Number(mediaResp.headers.get("content-length")) || size || 0;
                            if (mediaLength > 0) {
                              adjustTotalForActualSize(mediaLength, fileMeta.size);
                              ensureTotalAtLeast(downloadedBytes + mediaLength);
                              updateProgress(fileIndex);
                            }
                            const mediaBytes = await streamResponseToUint8Array(mediaResp, fileIndex);
                            console.info("LFS: media.githubusercontent.com returned object for", fileMeta.path);
                            ensureTotalAtLeast(downloadedBytes);
                            updateProgress(fileIndex);
                            return mediaBytes;
                          }
                        }
                      } catch (mediaErr) {
                        console.debug("LFS: media fallback failed", mediaErr);
                      }

                      const batchJson = JSON.stringify({ operation: "download", objects: [{ oid, size }] });
                      const curlCmd = "curl -s -X POST 'https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + ".git/info/lfs/objects/batch' -H 'Accept: application/vnd.git-lfs+json' -H 'Content-Type: application/json' -d '" + batchJson.replace(/'/g, "'\\''") + "'" + " | jq -r '.objects[0].actions.download.href'";
                      throw new Error(
                        "Git LFS pointer detected for '" + fileMeta.path + "' (oid=" + oid + ", size=" + size + ").\n" +
                        "CORS prevents the browser from calling the Git LFS batch API.\n" +
                        "You can run this command locally to get the presigned download URL:\n" +
                        curlCmd
                      );
                    }
                  } catch (e) {
                    // ignore decode failures and continue
                  }
                }
              }
            } catch (e) {
              // ignore API errors and fall back to raw fetch
            }
          }

          const res = await fetch(rawUrl, { cache: "no-store" });
          const rateLimitErr = checkGithubResponseRateLimit(res);
          if (rateLimitErr) {
            throw rateLimitErr;
          }
          if (!res.ok) {
            throw new Error("HTTP " + res.status + " for " + fileMeta.path);
          }
          if (res.body && typeof res.body.getReader === "function") {
            const reader = res.body.getReader();
            // Probe the first chunk to detect LFS pointer
            const firstRead = await reader.read();
            if (firstRead && !firstRead.done && firstRead.value) {
              try {
                const probeBytes = firstRead.value;
                const contentType = String(res.headers.get("content-type") || "").toLowerCase();
                if (contentType.includes("text") || contentType.includes("application/octet-stream") || contentType.includes("application/x-git-lfs")) {
                  const probeText = (() => {
                    try { return new TextDecoder().decode(probeBytes); } catch { return ""; }
                  })();
                  if (probeText.startsWith("version https://git-lfs.github.com/spec/v1")) {
                    // Parse pointer
                    const oidMatch = probeText.match(/oid sha256:([a-f0-9]{64})/i);
                    const sizeMatch = probeText.match(/size (\d+)/i);
                    if (oidMatch) {
                      const oid = oidMatch[1];
                      const size = sizeMatch ? Number(sizeMatch[1]) : 0;
                      console.info("LFS: detected pointer in repo file", fileMeta.path, { oid, size });
                      if (size > 0) {
                        adjustTotalForActualSize(size, fileMeta.size);
                        ensureTotalAtLeast(downloadedBytes + size);
                        updateProgress(fileIndex);
                      }

                      // derive owner/repo/branch from snapshot
                      const rawUrl = owner && repo && branch
                        ? "https://raw.githubusercontent.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + encodeURIComponent(branch) + "/" + fileMeta.path.split("/").map(encodeURIComponent).join("/")
                        : null;
                      if (rawUrl) {
                        // Try media.githubusercontent.com before calling batch API (some media URLs serve real object)
                        try {
                          const mediaUrl = "https://media.githubusercontent.com/media/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + encodeURIComponent(branch) + "/" + fileMeta.path.split("/").map(encodeURIComponent).join("/");
                          console.debug("LFS: attempting media.githubusercontent.com fallback for repo file", mediaUrl);
                          const mediaResp = await fetch(mediaUrl, { cache: "no-store", redirect: "follow" });
                          if (mediaResp && mediaResp.ok) {
                            const mediaLength = Number(mediaResp.headers.get("content-length")) || size || 0;
                            if (mediaLength > 0) {
                              adjustTotalForActualSize(mediaLength, fileMeta.size);
                              ensureTotalAtLeast(downloadedBytes + mediaLength);
                              updateProgress(fileIndex);
                            }
                            const mediaBytes = await streamResponseToUint8Array(mediaResp, fileIndex);
                            console.info("LFS: media.githubusercontent.com returned object for repo file", fileMeta.path);
                            ensureTotalAtLeast(downloadedBytes);
                            updateProgress(fileIndex);
                            return mediaBytes;
                          }
                        } catch (mediaErr) {
                          console.debug("LFS: media fallback failed for repo file", mediaErr);
                        }

                        const batchUrl = "https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + ".git/info/lfs/objects/batch";
                        const batchBody = JSON.stringify({ operation: "download", objects: [{ oid, size }] });
                        try {
                          console.debug("LFS: calling batch API for repo file", batchUrl);
                          const batchResp = await fetch(batchUrl, {
                            method: "POST",
                            headers: { Accept: "application/vnd.git-lfs+json", "Content-Type": "application/json" },
                            body: batchBody
                          });
                          if (batchResp && batchResp.ok) {
                            const batchJson = await batchResp.json();
                            const actions = batchJson && batchJson.objects && batchJson.objects[0] && batchJson.objects[0].actions;
                            const downloadAction = actions && (actions.download || actions.get);
                            if (downloadAction && downloadAction.href) {
                              console.info("LFS: obtained download href for repo file", downloadAction.href);
                              const objResp = await fetch(downloadAction.href, { cache: "no-store", redirect: "follow" });
                              if (objResp && objResp.ok) {
                                const objBytes = await streamResponseToUint8Array(objResp, fileIndex);
                                adjustTotalForActualSize(objBytes.length, fileMeta.size);
                                ensureTotalAtLeast(downloadedBytes);
                                updateProgress(fileIndex);
                                return objBytes;
                              }
                            }
                          }
                        } catch (e) {
                          console.error("LFS batch/download failed for repo file", e);
                        }
                      }
                    }
                  }
                }
              } catch (e) {
                console.error("LFS probe error for", fileMeta.path, e);
              }
            }

            // No LFS pointer handling or failed — continue streaming including first chunk
            const chunks = [];
            let fileBytes = 0;
            if (firstRead && firstRead.value) {
              chunks.push(firstRead.value);
              fileBytes += firstRead.value.byteLength || firstRead.value.length || 0;
              downloadedBytes += firstRead.value.byteLength || firstRead.value.length || 0;
              updateProgress(fileIndex);
            }
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              if (value) {
                chunks.push(value);
                fileBytes += value.byteLength;
                downloadedBytes += value.byteLength;
                updateProgress(fileIndex);
              }
            }
            const out = new Uint8Array(fileBytes);
            let offset = 0;
            for (const chunk of chunks) {
              out.set(chunk, offset);
              offset += chunk.byteLength;
            }
            return out;
          }
          const buf = await res.arrayBuffer();
          downloadedBytes += buf.byteLength;
          updateProgress(fileIndex);
          return new Uint8Array(buf);
        } catch (err) {
          lastError = err;
          if (isGithubRateLimitError(err)) {
            throw err;
          }
          // undo any bytes counted before the retry
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 300 * attempt));
          }
        }
      }
      throw lastError || new Error("Failed to download file " + fileMeta.path);
    };

    for (let i = 0; i < files.length; i += 1) {
      const fileMeta = files[i];
      setWorkProgressTree(i, files.length, fileMeta.path);
      const bytes = await fetchBytesStreaming(fileMeta, i);
      if (onFile) {
        try {
          await onFile(fileMeta, bytes, i);
        } catch (e) {
          // ensure failures in a user callback don't break the overall download loop
          console.error('onFile callback failed for', fileMeta.path, e);
        }
      } else {
        entries.push({
          path: fileMeta.path,
          bytes
        });
      }
      setWorkProgressTree(i + 1, files.length, fileMeta.path);
    }
    setWorkProgressTree(files.length, files.length, "");
    return entries;
  }

async function importGithubTreeDirect(snapshot, gameName, options) {
    const opts = options && typeof options === "object" ? options : {};
    const replaceGameIdOpt = typeof opts.replaceGameId === "string" ? opts.replaceGameId : "";
    try {
      setActionButtonsDisabled(true);
      const githubSource = {
        provider: "github-tree",
        owner: String(snapshot && snapshot.owner || ""),
        repo: String(snapshot && snapshot.repo || ""),
        branch: String(snapshot && snapshot.branch || ""),
        downloadedAt: Date.now()
      };

      if (opts.streamDuringDownload) {
        // Create a game record early so we can store files as they arrive
        let gameId = makeId();
        let preservedName = gameName || (String(snapshot.repo || "github-repo") + " (" + String(snapshot.branch || "main") + ")");
        // If caller wants to replace an existing game, prefer that id and remove old files first
        if (replaceGameIdOpt && state.gamesById.has(replaceGameIdOpt)) {
          gameId = replaceGameIdOpt;
          try {
            await deleteFilesByGameId(gameId);
          } catch (e) {
            console.warn('Failed to delete existing files for replaceGameId', gameId, e);
          }
          const existing = state.gamesById.get(gameId);
          if (existing && existing.name) preservedName = existing.name;
        }
        const gameRecord = {
          id: gameId,
          name: preservedName,
          zipName: preservedName + ".zip",
          importedAt: Date.now(),
          extractorVersion: CURRENT_EXTRACTOR_VERSION,
          sortOrder: getNextSortOrder(),
          fileCount: 0,
          totalBytes: 0,
          htmlEntries: [],
          entryPath: "",
          thumbnailDataUrl: "",
          githubSource: githubSource,
          unityDetected: false,
          flashDetected: false,
          importInProgress: true
        };
        await putGame(gameRecord);
        state.gamesById.set(gameId, gameRecord);
        const pending = [];
        try {
        const onFile = async (fileMeta, bytes, i) => {
          try {
            if (isStreamablePath(fileMeta.path)) {
              const blob = new Blob([bytes], { type: mimeFromPath(fileMeta.path) });
              await putFileRecord({ gameId, path: fileMeta.path, size: blob.size, type: blob.type, blob, transformations: [] });
              gameRecord.fileCount = (gameRecord.fileCount || 0) + 1;
              gameRecord.totalBytes = (gameRecord.totalBytes || 0) + blob.size;
              await putGame(gameRecord);
            } else {
              pending.push({ path: fileMeta.path, bytes });
            }
          } catch (e) {
            console.error('stream onFile failed for', fileMeta.path, e);
            // fallback: treat as pending
            pending.push({ path: fileMeta.path, bytes });
          }
        };

          await downloadGithubTreeEntries(snapshot, "Downloading " + (gameName || "repo"), { onFile, prioritizeSmallest: true, skipPatterns: opts.skipPatterns || [] });

          if (pending.length) {
            await importEntriesDirectly(pending, {
              existingGameId: gameId,
              gameName: preservedName,
              githubSource: githubSource,
              importMode: opts.importMode || "separate",
              manageUi: true
            });
          }
          // finalize: recompute stored-file stats and mark complete
          try {
            const stored = await getAllFilesForGame(gameId);
            gameRecord.fileCount = Array.isArray(stored) ? stored.length : gameRecord.fileCount;
            gameRecord.totalBytes = Array.isArray(stored) ? stored.reduce((s, f) => s + (Number(f.size) || 0), 0) : gameRecord.totalBytes;
            // compute html entries and best entryPath
            const paths = Array.isArray(stored) ? stored.map((f) => normalizePath(f.path || "")) : [];
            const htmlEntries = paths.filter((p) => /\.html?$/i.test(p)).sort((a, b) => a.localeCompare(b));
            gameRecord.htmlEntries = htmlEntries;
            gameRecord.entryPath = chooseBestEntryPath(htmlEntries, "");
            // detect Unity/Flash heuristics
            gameRecord.unityDetected = detectUnityByPaths(paths);
            gameRecord.flashDetected = detectFlashByPaths(paths);
            gameRecord.importInProgress = false;
            gameRecord.importedAt = Date.now();
            await putGame(gameRecord);
            state.gamesById.set(gameId, gameRecord);
          } catch (e) {
            console.error('Failed to finalize streamed game', e);
          }
          log("Imported from GitHub source.");
          return;
        } finally {
          // ensure importInProgress is cleared on error as well
          try {
            if (gameId && state.gamesById.has(gameId)) {
              const gr = state.gamesById.get(gameId);
              if (gr && gr.importInProgress) {
                gr.importInProgress = false;
                await putGame(gr);
                state.gamesById.set(gameId, gr);
              }
            }
          } catch (e) {
            // swallow
          }
        }
      }

      const entries = await downloadGithubTreeEntries(snapshot, "Downloading " + (gameName || "repo"));
      await importEntriesDirectly(entries, {
        gameName: gameName || (String(snapshot.repo || "github-repo") + " (" + String(snapshot.branch || "main") + ")"),
        githubSource: githubSource,
        importMode: opts.importMode || "separate",
        replaceGameId: opts.replaceGameId || "",
        manageUi: true
      });
    } finally {
      setActionButtonsDisabled(false);
    }
  }

async function downloadGithubRepoSnapshotZip(snapshot, label) {
    return buildZipFileFromGithubTree(snapshot, label || "Downloading repo files");
  }

async function downloadGithubReleaseZip(sourceMeta, label) {
    const source = sourceMeta && typeof sourceMeta === "object" ? sourceMeta : null;
    const primaryUrl = toHttpUrl(source && source.downloadUrl ? source.downloadUrl : "");
    let primaryError = null;
    if (primaryUrl) {
      try {
        return await downloadZipFromUrl(primaryUrl, label);
      } catch (error) {
        primaryError = error;
        console.error(error);
      }
    }
    const owner = String(source && source.owner || "").trim();
    const repo = String(source && source.repo || "").trim();
    const assetId = Number(source && source.assetId) || 0;
    if (!owner || !repo || !assetId) {
      throw primaryError || new Error("Release ZIP download failed and no api.github.com asset id is available.");
    }
    log("Direct github.com download failed; retrying release asset via api.github.com...");
    const apiUrl =
      "https://api.github.com/repos/" +
      encodeURIComponent(owner) + "/" +
      encodeURIComponent(repo) +
      "/releases/assets/" +
      encodeURIComponent(String(assetId));
    return downloadZipFromUrl(apiUrl, label, {
      headers: {
        Accept: "application/octet-stream",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      skipHead: true,
      fileNameHint: String(source.assetName || "") || (repo + "-release.zip")
    });
  }

async function fetchZipHeadInfo(url, options) {
    const opts = options && typeof options === "object" ? options : {};
    const normalizedUrl = toHttpUrl(url);
    if (!normalizedUrl) {
      throw new Error("Invalid ZIP URL.");
    }
    const headers = opts.headers && typeof opts.headers === "object" ? opts.headers : undefined;
    const response = await fetch(normalizedUrl, {
      method: "HEAD",
      cache: "no-store",
      headers
    });
    if (!response.ok) {
      throw new Error("HEAD request failed (" + response.status + ").");
    }
    return {
      url: toHttpUrl(response.url || normalizedUrl) || normalizedUrl,
      etag: normalizeHttpHeaderToken(response.headers.get("etag") || ""),
      lastModified: normalizeHttpHeaderToken(response.headers.get("last-modified") || ""),
      contentLength: Number(response.headers.get("content-length")) || 0
    };
  }

async function downloadZipFromUrl(url, label, options) {
    const opts = options && typeof options === "object" ? options : {};
    const normalizedUrl = toHttpUrl(url);
    if (!normalizedUrl) {
      throw new Error("Invalid ZIP URL.");
    }
    const requestHeaders = opts.headers && typeof opts.headers === "object" ? opts.headers : undefined;
    let expectedTotal = 0;
    if (!opts.skipHead) {
      try {
        const head = await fetchZipHeadInfo(normalizedUrl, { headers: requestHeaders });
        expectedTotal = Number(head.contentLength) || 0;
      } catch {
        expectedTotal = 0;
      }
    }
    const response = await fetch(normalizedUrl, {
      cache: "no-store",
      headers: requestHeaders,
      redirect: "follow"
    });
    if (!response.ok) {
      throw new Error("Download failed (" + response.status + ").");
    }
    const contentLength = Number(response.headers.get("content-length")) || 0;
    const total = contentLength || expectedTotal;
    const fileNameHint = String(opts.fileNameHint || "").trim();
    const reader = response.body && typeof response.body.getReader === "function"
      ? response.body.getReader()
      : null;
    // Try LFS pointer handling before streaming the whole response
    if (reader) {
      const lfsResult = await tryHandleLfsPointer();
      if (lfsResult && lfsResult.file) {
        // We obtained the real object packaged as a file/zip
        return lfsResult;
      }
      var probeChunk = lfsResult && lfsResult.probeChunk ? lfsResult.probeChunk : null;
    }
    // Detect Git LFS pointer files served from raw.githubusercontent.com and
    // automatically fetch the real object via the Git LFS batch API when possible.
    async function tryHandleLfsPointer() {
      try {
        console.debug("LFS: trying to detect pointer for", normalizedUrl);
        // Only attempt when response looks textual or small
        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        if (!contentType.includes("text") && !contentType.includes("application/octet-stream") && !contentType.includes("application/x-git-lfs")) {
          console.debug("LFS: skipping due to content-type", contentType);
          return null;
        }
        // Read a small prefix to detect pointer
        const probe = reader ? await reader.read() : null;
        if (!probe || probe.done || !probe.value) {
          if (probe && probe.done) {
            console.debug("LFS: stream ended before probe");
            return null;
          }
          console.debug("LFS: no probe data available");
          return null;
        }
        const firstBytes = probe.value;
        const text = (() => {
          try {
            return new TextDecoder().decode(firstBytes);
          } catch (e) {
            console.debug("LFS: decode error", e && e.message);
            return "";
          }
        })();
        if (!text.startsWith("version https://git-lfs.github.com/spec/v1")) {
          // Not an LFS pointer, push the chunk back to stream by returning it
          console.debug("LFS: not a pointer; first bytes:", text.slice(0, 200));
          return { probeChunk: firstBytes };
        }

        // Parse pointer
        const oidMatch = text.match(/oid sha256:([a-f0-9]{64})/i);
        const sizeMatch = text.match(/size (\d+)/i);
        if (!oidMatch) {
          console.debug("LFS: pointer missing oid");
          return null;
        }
        const oid = oidMatch[1];
        const size = sizeMatch ? Number(sizeMatch[1]) : 0;
        console.info("LFS: detected pointer", { oid, size });

        // Attempt to extract owner/repo from raw.githubusercontent.com URL
        const rawMatch = normalizedUrl.match(/^https?:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)$/i);
        if (!rawMatch) {
          console.debug("LFS: could not parse owner/repo from URL");
          return null;
        }
        const owner = rawMatch[1];
        const repo = rawMatch[2];
        const branch = rawMatch[3];

        const branchUrl = owner && repo && branch
          ? "https://media.githubusercontent.com/media/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + encodeURIComponent(branch) + "/" + normalizedUrl.split("/").slice(5).map(encodeURIComponent).join("/")
          : null;
        if (branchUrl) {
          try {
            console.debug("LFS: attempting media.githubusercontent.com fallback for direct URL", branchUrl);
            const mediaResp = await fetch(branchUrl, { cache: "no-store", redirect: "follow" });
            if (mediaResp && mediaResp.ok) {
              const mediaSize = Number(mediaResp.headers.get("content-length")) || size || 1;
              setWorkProgress("Downloading LFS object", 0, mediaSize);
              const mediaBuf = await mediaResp.arrayBuffer();
              console.info("LFS: media.githubusercontent.com returned object for direct URL");
              const mediaBytes = new Uint8Array(mediaBuf);
              if (mediaBytes.length > size) {
                setWorkProgress("Downloading LFS object", mediaBytes.length, mediaSize);
              }
              const pathParts = normalizedUrl.split("/");
              const fileName = pathParts[pathParts.length - 1] || (oid + ".bin");
              if (mediaBytes.length >= 4 && mediaBytes[0] === 0x50 && mediaBytes[1] === 0x4b && mediaBytes[2] === 0x03 && mediaBytes[3] === 0x04) {
                return {
                  file: new File([mediaBytes], fileName, { type: "application/zip" }),
                  resolvedUrl: branchUrl,
                  etag: normalizeHttpHeaderToken(mediaResp.headers.get("etag") || ""),
                  lastModified: normalizeHttpHeaderToken(mediaResp.headers.get("last-modified") || "")
                };
              }
              const zipBytes = createZipStoreArchive([{ path: fileName, bytes: mediaBytes }]);
              return {
                file: new File([zipBytes], fileName + ".zip", { type: "application/zip" }),
                resolvedUrl: branchUrl,
                etag: normalizeHttpHeaderToken(mediaResp.headers.get("etag") || ""),
                lastModified: normalizeHttpHeaderToken(mediaResp.headers.get("last-modified") || "")
              };
            }
          } catch (mediaErr) {
            console.debug("LFS: direct media fallback failed", mediaErr);
          }
        }

        const batchUrl = "https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + ".git/info/lfs/objects/batch";
        const batchBody = JSON.stringify({ operation: "download", objects: [{ oid, size }] });
        console.debug("LFS: calling batch API", batchUrl);
        const batchResp = await fetch(batchUrl, {
          method: "POST",
          headers: {
            Accept: "application/vnd.git-lfs+json",
            "Content-Type": "application/json"
          },
          body: batchBody
        });
        if (!batchResp.ok) {
          console.debug("LFS: batch API failed", batchResp.status);
          return null;
        }
        const batchJson = await batchResp.json();
        const actions = batchJson && batchJson.objects && batchJson.objects[0] && batchJson.objects[0].actions;
        const downloadAction = actions && (actions.download || actions.get);
        if (!downloadAction || !downloadAction.href) {
          console.debug("LFS: no download action in batch response");
          return null;
        }
        const downloadHref = downloadAction.href;
        console.info("LFS: obtained download href", downloadHref);

        const objResp = await fetch(downloadHref, { cache: "no-store", redirect: "follow" });
        if (!objResp.ok) throw new Error("LFS object download failed (" + objResp.status + ")");
        const objSize = Number(objResp.headers.get("content-length")) || size || 1;
        setWorkProgress("Downloading LFS object", 0, objSize);
        const objBuf = await objResp.arrayBuffer();
        const objBytes = new Uint8Array(objBuf);

        if (objBytes.length !== objSize) {
          setWorkProgress("Downloading LFS object", objBytes.length, objSize);
        }

        // Determine filename from original path
        const pathParts = normalizedUrl.split("/");
        const fileName = pathParts[pathParts.length - 1] || (oid + ".bin");

        // If the object is already a ZIP, return it; otherwise package into a ZIP
        if (objBytes.length >= 4 && objBytes[0] === 0x50 && objBytes[1] === 0x4b && objBytes[2] === 0x03 && objBytes[3] === 0x04) {
          console.info("LFS: downloaded zip object, returning as zip");
          return {
            file: new File([objBytes], fileName, { type: "application/zip" }),
            resolvedUrl: downloadHref,
            etag: normalizeHttpHeaderToken(objResp.headers.get("etag") || ""),
            lastModified: normalizeHttpHeaderToken(objResp.headers.get("last-modified") || "")
          };
        }

        // Create a simple zip with the single file using createZipStoreArchive
        console.info("LFS: wrapping object into zip", fileName);
        const zipBytes = createZipStoreArchive([{ path: fileName, bytes: objBytes }]);
        const zipFile = new File([zipBytes], fileName + ".zip", { type: "application/zip" });
        return { file: zipFile, resolvedUrl: downloadHref, etag: normalizeHttpHeaderToken(objResp.headers.get("etag") || ""), lastModified: normalizeHttpHeaderToken(objResp.headers.get("last-modified") || "") };
      } catch (error) {
        // If anything fails, don't block normal download flow
        console.error("LFS detection/fetch failed:", error);
        return null;
      }
    }
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      setWorkProgress(label || "Downloading ZIP", bytes.byteLength, bytes.byteLength || 1);
      let fileName = extractZipFileNameFromResponse(response, normalizedUrl);
      if (fileNameHint && (!fileName || fileName === "download.zip" || !/\.zip$/i.test(fileName))) {
        fileName = fileNameHint;
      }
      const outName = /\.zip$/i.test(fileName) ? fileName : (fileName + ".zip");
      return {
        file: new File([bytes], outName, { type: "application/zip" }),
        resolvedUrl: toHttpUrl(response.url || normalizedUrl) || normalizedUrl,
        etag: normalizeHttpHeaderToken(response.headers.get("etag") || ""),
        lastModified: normalizeHttpHeaderToken(response.headers.get("last-modified") || "")
      };
    }

    let loaded = 0;
    let lastReported = 0;
    const chunks = [];
    if (probeChunk) {
      chunks.push(probeChunk);
      loaded += probeChunk.byteLength || probeChunk.length || 0;
    }
    setWorkProgress(label || "Downloading ZIP", 0, total > 0 ? total : 0);
    while (true) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      const chunk = part.value;
      if (!chunk) {
        continue;
      }
      chunks.push(chunk);
      loaded += chunk.byteLength;
      if (loaded - lastReported >= 262144 || (total > 0 && loaded >= total)) {
        if (total > 0) {
          setWorkProgress(label || "Downloading ZIP", loaded, total);
        } else {
          setWorkProgress((label || "Downloading ZIP") + " (" + formatBytes(loaded) + ")", 0, 0);
        }
        lastReported = loaded;
      }
    }
    if (total > 0) {
      setWorkProgress(label || "Downloading ZIP", loaded, total);
    } else {
      setWorkProgress(label || "Download complete", loaded || 1, loaded || 1);
    }
    const blob = new Blob(chunks, { type: "application/zip" });
    let fileName = extractZipFileNameFromResponse(response, normalizedUrl);
    if (fileNameHint && (!fileName || fileName === "download.zip" || !/\.zip$/i.test(fileName))) {
      fileName = fileNameHint;
    }
    const outName = /\.zip$/i.test(fileName) ? fileName : (fileName + ".zip");
    return {
      file: new File([blob], outName, { type: "application/zip" }),
      resolvedUrl: toHttpUrl(response.url || normalizedUrl) || normalizedUrl,
      etag: normalizeHttpHeaderToken(response.headers.get("etag") || ""),
      lastModified: normalizeHttpHeaderToken(response.headers.get("last-modified") || "")
    };
  }

function githubReleaseHasUpdate(previousSource, latestSource) {
    const prev = normalizeGithubSource(previousSource);
    const next = normalizeGithubSource(latestSource);
    if (!prev || !next || prev.provider !== "github-release" || next.provider !== "github-release") {
      return false;
    }
    if (prev.assetId && next.assetId) {
      return prev.assetId !== next.assetId;
    }
    if (prev.releaseTag && next.releaseTag) {
      return prev.releaseTag !== next.releaseTag;
    }
    if (prev.assetUpdatedAt && next.assetUpdatedAt) {
      return next.assetUpdatedAt > prev.assetUpdatedAt;
    }
    return prev.downloadUrl !== next.downloadUrl;
  }

function zipUrlHasUpdate(previousSource, remoteHeadInfo) {
    const prev = normalizeGithubSource(previousSource);
    if (!prev || prev.provider !== "zip-url") {
      return false;
    }
    const nextEtag = normalizeHttpHeaderToken(remoteHeadInfo && remoteHeadInfo.etag ? remoteHeadInfo.etag : "");
    const nextLastModified = normalizeHttpHeaderToken(remoteHeadInfo && remoteHeadInfo.lastModified ? remoteHeadInfo.lastModified : "");
    if (prev.etag && nextEtag) {
      return prev.etag !== nextEtag;
    }
    if (prev.lastModified && nextLastModified) {
      return prev.lastModified !== nextLastModified;
    }
    return false;
  }

async function importEntriesDirectly(entries, options) {
    const opts = options && typeof options === "object" ? options : {};
    const requestedMode = opts.importMode === "replace" || opts.importMode === "separate"
      ? opts.importMode
      : "";
    const replaceGameId = typeof opts.replaceGameId === "string" ? opts.replaceGameId : "";
    const existingGameId = typeof opts.existingGameId === "string" ? opts.existingGameId : "";
    const incomingGithubSource = normalizeGithubSource(opts.githubSource);
    const gameName = typeof opts.gameName === "string" ? opts.gameName : "Imported Game";
    const manageUi = opts.manageUi !== false;

    const fileEntries = Array.isArray(entries) ? entries : [];
    if (!fileEntries.length) {
      throw new Error("No files to import.");
    }

    const existingGame = existingGameId && state.gamesById.has(existingGameId)
      ? state.gamesById.get(existingGameId)
      : (replaceGameId && state.gamesById.has(replaceGameId) ? state.gamesById.get(replaceGameId) : null);

    let importMode = "separate";
    if (requestedMode) {
      importMode = requestedMode === "replace" && existingGame ? "replace" : "separate";
    } else if (existingGame) {
      importMode = "separate";
    }

    if (manageUi) {
      setActionButtonsDisabled(true);
    }

    const gameId = existingGameId ? existingGameId : (importMode === "replace" && existingGame ? existingGame.id : makeId());
    const preservedThumbnail = importMode === "replace" && existingGame
      ? (typeof existingGame.thumbnailDataUrl === "string" ? existingGame.thumbnailDataUrl : "")
      : "";
    const preservedName = importMode === "replace" && existingGame
      ? String(existingGame.name || gameName)
      : gameName;
    const preservedSortOrder = importMode === "replace" && existingGame
      ? Number(existingGame.sortOrder)
      : Number.MAX_SAFE_INTEGER;
    const resolvedGithubSource = incomingGithubSource || (
      importMode === "replace" && existingGame ? normalizeGithubSource(existingGame.githubSource) : null
    );

    try {
      const processedEntries = [];
      const brotliDecodedPaths = new Set();
      const seenPaths = new Map();

      setWorkProgress("Processing entries", 0, fileEntries.length);

      for (let idx = 0; idx < fileEntries.length; idx++) {
        const entry = fileEntries[idx];
        const entryBytes = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
        let path = normalizePath(entry.path || "");
        let bytes = entryBytes;
        let brotliDecoded = false;

        if (/\.br$/i.test(path)) {
          try {
            bytes = await inflateBrotli(entryBytes);
            path = path.replace(/\.br$/i, "");
            brotliDecodedPaths.add(path);
            brotliDecoded = true;
          } catch (error) {
            console.error(error);
            log("Brotli decode failed for " + entry.path + ". Keeping compressed version.", "error");
          }
        }

        if (seenPaths.has(path)) {
          const existingIndex = seenPaths.get(path);
          if (brotliDecoded && typeof existingIndex === "number") {
            processedEntries[existingIndex] = {
              path,
              bytes,
              originalPath: entry.path
            };
          }
          continue;
        }

        seenPaths.set(path, processedEntries.length);
        processedEntries.push({
          path,
          bytes,
          originalPath: entry.path
        });

        if ((idx + 1) % 50 === 0) {
          setWorkProgress("Processing entries", idx + 1, fileEntries.length);
        }
      }

      const brotliReplacementMap = buildBrotliReplacementMap(brotliDecodedPaths);

      setWorkProgress("Optimizing game assets", 0, 0);
      for (const entry of processedEntries) {
        const transformed = applyCurrentExtractorTransformations(entry.path, entry.bytes, {
          brotliDecodedPaths,
          brotliReplacementMap
        });
        entry.bytes = transformed.bytes;
        entry.transformations = transformed.transformations;
      }

      await applyPreLaunchTransformations(processedEntries);

      const htmlEntries = processedEntries
        .map((entry) => entry.path)
        .filter((path) => /\.html?$/i.test(path))
        .sort((a, b) => a.localeCompare(b));

      if (detectSharedArrayBufferUsage(processedEntries)) {
        const sabDecision = await askSharedArrayBufferDecision();
        if (sabDecision !== "optionB") {
          log("Import canceled (SharedArrayBuffer).");
          if (manageUi) setActionButtonsDisabled(false);
          return;
        }
        log("Importing despite SharedArrayBuffer. The game may not work on file://.");
      }

      const gameRecord = {
        id: gameId,
        name: preservedName,
        zipName: gameName + ".zip",
        importedAt: Date.now(),
        extractorVersion: CURRENT_EXTRACTOR_VERSION,
        sortOrder: Number.isFinite(preservedSortOrder) ? preservedSortOrder : getNextSortOrder(),
        fileCount: processedEntries.length,
        totalBytes: 0,
        htmlEntries,
        entryPath: chooseBestEntryPath(htmlEntries, ""),
        thumbnailDataUrl: preservedThumbnail,
        githubSource: resolvedGithubSource,
        unityDetected: detectUnityByPaths(processedEntries.map((entry) => entry.path)),
        flashDetected: detectFlashByPaths(processedEntries.map((entry) => entry.path))
      };

      if (importMode === "replace" && existingGame) {
        await deleteFilesByGameId(existingGame.id);
        log("Replacing existing game: " + (existingGame.name || existingGame.id));
      }

      let processed = 0;
      let totalBytes = 0;
      setWorkProgress("Importing game files", 0, processedEntries.length);

      for (const entry of processedEntries) {
        const entryBytes = entry.bytes;
        const transformations = entry.transformations;

        const blob = new Blob([entryBytes], { type: mimeFromPath(entry.path) });
        totalBytes += blob.size;

        await putFileRecord({
          gameId,
          path: entry.path,
          size: blob.size,
          type: blob.type,
          blob,
          transformations
        });

        if (!gameRecord.unityDetected && /\.html?$/i.test(entry.path)) {
          try {
            const htmlText = decodeUtf8(entryBytes);
            if (detectUnityByHtmlText(htmlText)) {
              gameRecord.unityDetected = true;
            }
          } catch {
            // ignore decode errors
          }
        }

        processed += 1;
        if (processed % 20 === 0 || processed === processedEntries.length) {
          setWorkProgress("Importing game files", processed, processedEntries.length);
        }
        if (processed % 40 === 0 || processed === processedEntries.length) {
          log("Imported " + processed + "/" + processedEntries.length + " files...");
        }
      }

      gameRecord.totalBytes = totalBytes;
      await putGame(gameRecord);
      state.gamesById.set(gameId, gameRecord);
      await loadLibrary(gameId);

      log("Imported game: " + preservedName + " (" + processedEntries.length + " files)");
    } finally {
      if (manageUi) {
        setActionButtonsDisabled(false);
      }
    }
  }
