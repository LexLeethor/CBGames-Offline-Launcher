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
      const htmlEntries = processedEntries
        .map((entry) => entry.path)
        .filter((path) => /\.html?$/i.test(path))
        .sort((a, b) => a.localeCompare(b));

      // Check for SharedArrayBuffer usage (known limitation)
      if (detectSharedArrayBufferUsage(processedEntries)) {
        throw new Error(
          "This game uses SharedArrayBuffer, which is not supported in the file:// protocol. " +
          "This is a known limitation of the offline launcher and this game cannot be imported."
        );
      }

      const gameRecord = {
        id: gameId,
        name: preservedName,
        zipName: file.name,
        importedAt: Date.now(),
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
        let entryBytes = entry.bytes;
        const isTextFile = /\.(?:html?|js|mjs|cjs|css|json)$/i.test(entry.path);
        if (brotliReplacementMap.size && isTextFile) {
          try {
            const originalText = decodeUtf8(entryBytes);
            const replacedText = stripGenericBrotliSuffixes(
              replaceBrReferencesInText(originalText, brotliReplacementMap)
            );
            if (replacedText !== originalText) {
              entryBytes = new TextEncoder().encode(replacedText);
            }
          } catch {
            // ignore decode failures
          }
        }
        if (brotliDecodedPaths.size && /\.json$/i.test(entry.path)) {
          try {
            const jsonText = decodeUtf8(entryBytes);
            const jsonValue = JSON.parse(jsonText);
            const rewritten = replaceBrUrlsInObject(jsonValue, brotliDecodedPaths);
            const rewrittenText = JSON.stringify(rewritten);
            if (rewrittenText !== jsonText) {
              entryBytes = new TextEncoder().encode(rewrittenText);
            }
          } catch {
            // ignore JSON rewrite failures
          }
        }

        const blob = new Blob([entryBytes], { type: mimeFromPath(entry.path) });
        totalBytes += blob.size;

        await putFileRecord({
          gameId,
          path: entry.path,
          size: blob.size,
          type: blob.type,
          blob
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
      if (msg.startsWith("This looks like") || msg.includes("SharedArrayBuffer")) {
        openWrongZipTypeModal(msg);
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
        try {
          sourceMeta = await fetchLatestGithubReleaseInfo(repoRef.owner, repoRef.repo, "");
          downloadUrl = sourceMeta.downloadUrl;
        } catch (error) {
          const message = String(error && error.message ? error.message : error);
          const noRelease = /No latest release found|\/releases\/latest|no \.zip asset/i.test(message);
          if (!noRelease) {
            throw error;
          }
          setWorkProgress("No release found, reading repo tree", 0, 0);
          const snapshot = await fetchGithubRepoTreeSnapshot(repoRef.owner, repoRef.repo, "");
          const repoZipFile = await buildZipFileFromGithubTree(snapshot, "Downloading repo files");
          sourceMeta = {
            provider: "github-tree",
            owner: snapshot.owner,
            repo: snapshot.repo,
            branch: snapshot.branch,
            treeSha: snapshot.treeSha,
            lastCheckedAt: Date.now()
          };
          await importZipFile(repoZipFile, {
            githubSource: sourceMeta,
            manageUi: false
          });
          log("Imported from GitHub source.");
          return;
        }
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
      if (sourceMeta.provider === "github-release") {
        sourceMeta.etag = download.etag;
        sourceMeta.lastModified = download.lastModified;
      } else {
        sourceMeta.url = download.resolvedUrl || sourceMeta.url;
        sourceMeta.etag = download.etag;
        sourceMeta.lastModified = download.lastModified;
      }
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
          const repoZipFile = await buildZipFileFromGithubTree(latestTree, "Downloading repo files");
          const mergedSource = normalizeGithubSource({
            provider: "github-tree",
            owner: latestTree.owner,
            repo: latestTree.repo,
            branch: latestTree.branch,
            treeSha: latestTree.treeSha,
            lastCheckedAt: Date.now()
          });
          await importZipFile(repoZipFile, {
            importMode: "replace",
            replaceGameId: selected.id,
            githubSource: mergedSource,
            manageUi: false
          });
        } else {
          const downloadUrl = source.provider === "github-release"
            ? String(nextSource.downloadUrl || source.downloadUrl || "")
            : String(source.url || "");
          const download = await downloadZipFromUrl(downloadUrl, "Downloading update");
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
    if (!treeResponse.ok) {
      throw new Error("GitHub tree lookup failed (" + treeResponse.status + ").");
    }
    const tree = await treeResponse.json();
    const treeSha = String(tree.sha || "").trim();
    const rawEntries = Array.isArray(tree.tree) ? tree.tree : [];
    const fileEntries = rawEntries
      .filter((entry) => entry && entry.type === "blob" && typeof entry.path === "string" && entry.path)
      .map((entry) => ({
        path: normalizePath(entry.path),
        url: toHttpUrl(entry.url || ""),
        sha: String(entry.sha || ""),
        size: Number(entry.size) || 0
      }))
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
    const entries = [];
    const files = Array.isArray(snapshot && snapshot.fileEntries) ? snapshot.fileEntries : [];
    const progressLabel = String(labelPrefix || "Downloading repo files");
    const hasKnownSizes = files.every((file) => Number.isFinite(file && file.size) && Number(file.size) >= 0);
    const totalBytes = hasKnownSizes
      ? files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
      : 0;
    let downloadedBytes = 0;
    const updateProgress = () => {
      if (totalBytes > 0) {
        setWorkProgress(
          progressLabel,
          downloadedBytes,
          totalBytes,
          {
            currentText: formatBytes(downloadedBytes),
            totalText: formatBytes(totalBytes)
          }
        );
      } else {
        setWorkProgress(progressLabel + " (" + formatBytes(downloadedBytes) + ")", 0, 0);
      }
    };
    updateProgress();
    for (let i = 0; i < files.length; i += 1) {
      const fileMeta = files[i];
      const blobResponse = await fetch(fileMeta.url, {
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github.raw"
        }
      });
      if (!blobResponse.ok) {
        throw new Error("GitHub blob download failed (" + blobResponse.status + ") for " + fileMeta.path + ".");
      }
      let bytes = null;
      const rawType = String(blobResponse.headers.get("content-type") || "").toLowerCase();
      if (blobResponse.body && typeof blobResponse.body.getReader === "function" && rawType.indexOf("application/json") === -1) {
        const reader = blobResponse.body.getReader();
        const chunks = [];
        let loadedForFile = 0;
        let lastProgressReported = 0;
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
          loadedForFile += chunk.byteLength;
          downloadedBytes += chunk.byteLength;
          if (downloadedBytes - lastProgressReported >= 131072) {
            updateProgress();
            lastProgressReported = downloadedBytes;
          }
        }
        bytes = new Uint8Array(loadedForFile);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        updateProgress();
      } else {
        const fallbackResponse = rawType.indexOf("application/json") !== -1
          ? blobResponse
          : await fetch(fileMeta.url, {
              cache: "no-store",
              headers: {
                Accept: "application/vnd.github+json"
              }
            });
        if (!fallbackResponse.ok) {
          throw new Error("GitHub blob fallback failed (" + fallbackResponse.status + ") for " + fileMeta.path + ".");
        }
        const blobPayload = await fallbackResponse.json();
        const encoding = String(blobPayload.encoding || "").toLowerCase();
        if (encoding !== "base64") {
          throw new Error("Unsupported blob encoding for " + fileMeta.path + ".");
        }
        const content = String(blobPayload.content || "").replace(/\s+/g, "");
        bytes = base64ToBytes(content);
        downloadedBytes += bytes.byteLength;
        updateProgress();
      }
      entries.push({
        path: fileMeta.path,
        bytes
      });
    }
    const zipBlob = createZipStoreArchive(entries);
    const fileName = String(snapshot.repo || "github-repo") + "-" + String(snapshot.branch || "branch") + ".zip";
    return new File([zipBlob], fileName, { type: "application/zip" });
  }

async function fetchZipHeadInfo(url) {
    const normalizedUrl = toHttpUrl(url);
    if (!normalizedUrl) {
      throw new Error("Invalid ZIP URL.");
    }
    const response = await fetch(normalizedUrl, { method: "HEAD", cache: "no-store" });
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

async function downloadZipFromUrl(url, label) {
    const normalizedUrl = toHttpUrl(url);
    if (!normalizedUrl) {
      throw new Error("Invalid ZIP URL.");
    }
    let expectedTotal = 0;
    try {
      const head = await fetchZipHeadInfo(normalizedUrl);
      expectedTotal = Number(head.contentLength) || 0;
    } catch {
      expectedTotal = 0;
    }
    const response = await fetch(normalizedUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Download failed (" + response.status + ").");
    }
    const contentLength = Number(response.headers.get("content-length")) || 0;
    const total = contentLength || expectedTotal;
    const reader = response.body && typeof response.body.getReader === "function"
      ? response.body.getReader()
      : null;
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      setWorkProgress(label || "Downloading ZIP", bytes.byteLength, bytes.byteLength || 1);
      const fileName = extractZipFileNameFromResponse(response, normalizedUrl);
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
    const fileName = extractZipFileNameFromResponse(response, normalizedUrl);
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
