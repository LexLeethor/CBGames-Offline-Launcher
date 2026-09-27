"use strict";

async function pickZipFile() {
    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: false,
          types: [
            {
              description: "Game archives",
              accept: {
                "application/zip": [".zip"],
                "application/x-zip-compressed": [".zip"],
                "application/x-tar": [".tar"],
                "application/x-xz": [".tar.xz", ".txz"],
                "application/gzip": [".tar.gz", ".tgz"]
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
        openWrongZipTypeModal(error.message || String(error), "Import Failed");
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
      openWrongZipTypeModal("Choose a valid game to replace.", "Import Failed");
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
              description: "Game archives",
              accept: {
                "application/zip": [".zip"],
                "application/x-zip-compressed": [".zip"],
                "application/x-tar": [".tar"],
                "application/x-xz": [".tar.xz", ".txz"],
                "application/gzip": [".tar.gz", ".tgz"]
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
        openWrongZipTypeModal(error.message || String(error), "Import Failed");
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

async function importTarGameFile(file, options) {
    const opts = options && typeof options === "object" ? options : {};
    const existingGame = opts.replaceGameId && state.gamesById.has(opts.replaceGameId)
      ? state.gamesById.get(opts.replaceGameId)
      : findExistingGameMatchForImport(file.name);
    let importMode = opts.importMode === "replace" && existingGame ? "replace" : "separate";
    if (opts.importMode === "replace" && !existingGame) {
      const message = "Choose a valid game to replace.";
      log(message, "error");
      openWrongZipTypeModal(message, "Import Failed");
      return;
    }
    if (!opts.importMode && existingGame) {
      const decision = await askImportConflictDecision(existingGame, file.name);
      if (!decision || decision === "cancel") {
        log("Import canceled.");
        return;
      }
      importMode = decision === "optionB" ? "replace" : "separate";
    }

    if (typeof onTutorialZipImportStarted === "function") onTutorialZipImportStarted();
    setActionButtonsDisabled(true);
    try {
      setWorkProgress("Reading game archive", 0, 0);
      log("Reading game archive: " + file.name);
      const entries = await readGameArchiveEntries(file, {
        onEntryPath: (currentPath, discoveredPaths) => {
          const discoveredCount = discoveredPaths.length;
          setWorkProgressTree(
            Math.max(0, discoveredCount - 1),
            discoveredCount,
            currentPath,
            discoveredPaths
          );
        }
      });
      await importEntriesDirectly(entries, {
        trackProgressTree: true,
        gameName: importMode === "replace" && existingGame
          ? String(existingGame.name || deriveGameName(file.name))
          : deriveGameName(file.name),
        archiveName: file.name,
        existingGameId: importMode === "replace" && existingGame ? existingGame.id : "",
        replaceGameId: importMode === "replace" && existingGame ? existingGame.id : "",
        importMode,
        manageUi: false
      });
    } catch (error) {
      console.error(error);
      const message = "Import failed: " + (error.message || String(error));
      log(message, "error");
      openWrongZipTypeModal(error.message || String(error), "Import Failed");
    } finally {
      setActionButtonsDisabled(false);
      clearWorkProgress();
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
    if (!isGameArchiveInput(file)) {
      const message = "Choose a ZIP, TAR, TAR.XZ, or TAR.GZ game archive.";
      log(message, "error");
      openWrongZipTypeModal(message, "Import Failed");
      return;
    }
    if (!/\.zip$/i.test(file.name)) {
      await importTarGameFile(file, opts);
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
      let zipBuffer = await readFileArrayBufferWithProgress(file, "Reading ZIP");
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
      // ZIP central-directory paths are available before payload extraction begins.
      setWorkProgressTree(0, zip.entries.length, "", zip.entries.map((entry) => entry.path));
      const trackProgressTree = true;
      let advertisedGameBytes = 0;
      for (const entry of zip.entries) {
        advertisedGameBytes = addGameImportBytes(advertisedGameBytes, entry.uncompressedSize);
      }
      if (isGameImportOversized(advertisedGameBytes)) {
        const proceed = await askLargeGameImportDecision(deriveGameName(file.name), advertisedGameBytes);
        if (!proceed) {
          log("Import canceled after the large-game warning.", "info");
          return;
        }
      }

      const processedEntries = [];
      const brotliDecodedPaths = new Set();
      const seenPaths = new Map();
      let launcherMetadata = { name: "", thumbnailDataUrl: "" };
      let oversizedImportConfirmed = isGameImportOversized(advertisedGameBytes);
      for (let idx = 0; idx < zip.entries.length; idx += 1) {
        const entry = zip.entries[idx];
        setWorkProgressTree(idx, zip.entries.length, entry.path);
        let entryBytes = await extractEntryBytes(zip, entry);
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
            processedEntries[existingIndex].bytes = null;
            processedEntries[existingIndex] = {
              path,
              bytes,
              originalPath: entry.path
            };
          }
          entryBytes = null;
          bytes = null;
          setWorkProgressTree(idx + 1, zip.entries.length, entry.path);
          continue;
        }
        seenPaths.set(path, processedEntries.length);
        processedEntries.push({
          path,
          bytes,
          originalPath: entry.path
        });
        entryBytes = null;
        bytes = null;
        setWorkProgressTree(idx + 1, zip.entries.length, entry.path);
      }

      // Extracted payloads are now independent of the ZIP buffer; drop the archive before transformations.
      zip.bytes = null;
      zip.view = null;
      zip.entries.length = 0;
      zipBuffer = null;

      const brotliReplacementMap = buildBrotliReplacementMap(brotliDecodedPaths);
      launcherMetadata = detectLauncherMetadata(processedEntries);

      setWorkProgress("Patching Files", 0, 0);
      setWorkProgressTree(0, processedEntries.length, "", processedEntries.map((entry) => entry.path));
      for (let idx = 0; idx < processedEntries.length; idx += 1) {
        const entry = processedEntries[idx];
        setWorkProgressTree(idx, processedEntries.length, entry.path);
        const transformed = applyCurrentExtractorTransformations(entry.path, entry.bytes, {
          brotliDecodedPaths,
          brotliReplacementMap
        });
        entry.bytes = transformed.bytes;
        entry.transformations = transformed.transformations;
        setWorkProgressTree(idx + 1, processedEntries.length, entry.path);
      }

      await applyPreLaunchTransformations(processedEntries);
      setWorkProgressTree(processedEntries.length, processedEntries.length, "");
      let processedGameBytes = 0;
      for (const entry of processedEntries) {
        processedGameBytes = addGameImportBytes(processedGameBytes, entry.bytes.byteLength);
      }
      if (isGameImportOversized(processedGameBytes) && !oversizedImportConfirmed) {
        const proceed = await askLargeGameImportDecision(deriveGameName(file.name), processedGameBytes);
        if (!proceed) {
          log("Import canceled after the large-game warning.", "info");
          return;
        }
        oversizedImportConfirmed = true;
      }

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

      const autoThumbnailDataUrl = findAutoThumbnailDataUrl(processedEntries);
      const effectiveName = String(launcherMetadata.name || preservedName || deriveGameName(file.name)).trim() || deriveGameName(file.name);
      const gameRecord = {
        id: gameId,
        name: effectiveName,
        zipName: file.name,
        importedAt: Date.now(),
        extractorVersion: CURRENT_EXTRACTOR_VERSION,
        sortOrder: Number.isFinite(preservedSortOrder) ? preservedSortOrder : getNextSortOrder(),
        fileCount: processedEntries.length,
        totalBytes: 0,
        htmlEntries,
        entryPath: chooseBestEntryPath(htmlEntries, ""),
        thumbnailDataUrl: preservedThumbnail || launcherMetadata.thumbnailDataUrl || autoThumbnailDataUrl,
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
      if (trackProgressTree) {
        setWorkProgressTree(0, processedEntries.length, "", processedEntries.map((entry) => entry.path));
      }

      for (const entry of processedEntries) {
        if (trackProgressTree) setWorkProgressTree(processed, processedEntries.length, entry.path);
        const entryBytes = entry.bytes;
        const transformations = entry.transformations;

        const blob = new Blob([entryBytes], { type: mimeFromPath(entry.path) });
        totalBytes = addGameImportBytes(totalBytes, blob.size);

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
        if (trackProgressTree) setWorkProgressTree(processed, processedEntries.length, entry.path);
        // IndexedDB has its Blob now; avoid retaining every source buffer until the import ends.
        entry.bytes = null;
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
        if (opts.suppressEdit !== true) openGameEditModal(gameId);
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
        openWrongZipTypeModal(msg, "Import Failed");
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
    const archiveFiles = files.filter((file) => isGameArchiveInput(file));
    if (!archiveFiles.length) {
      const message = "Drop one or more game archives (.zip, .tar, .tar.xz, .tar.gz, or .tgz).";
      log(message, "error");
      openWrongZipTypeModal(message, "Import Failed");
      return;
    }

    for (const file of archiveFiles) {
      try {
        setDragDropOverlay(true, "Inspecting " + file.name + "...");
        const kind = isZipLikeFile(file) ? await detectDroppedZipKind(file) : "game";
        setDragDropOverlay(false);

        if (kind === "invalid-zip") {
          const message = "Could not read ZIP: " + file.name;
          log(message, "error");
          openWrongZipTypeModal(message, "Import Failed");
          continue;
        }

        if (kind === "bundle") {
          log("Detected bundle ZIP: " + file.name);
          await importBundleFile(file);
        } else {
          log("Detected game archive: " + file.name);
          await importZipFile(file);
        }
      } catch (error) {
        console.error(error);
        const message = "Could not import " + file.name + ": " + (error.message || String(error));
        log(message, "error");
        openWrongZipTypeModal(message, "Import Failed");
      } finally {
        setDragDropOverlay(false);
      }
    }
  }

async function importEntriesDirectly(entries, options) {
    const opts = options && typeof options === "object" ? options : {};
    const requestedMode = opts.importMode === "replace" || opts.importMode === "separate"
      ? opts.importMode
      : "";
    const replaceGameId = typeof opts.replaceGameId === "string" ? opts.replaceGameId : "";
    const existingGameId = typeof opts.existingGameId === "string" ? opts.existingGameId : "";
    const incomingGithubSource = normalizeGithubSource(opts.githubSource);
    const incomingMirrorSource = opts.mirrorSource && typeof opts.mirrorSource === "object" ? opts.mirrorSource : null;
    const gameName = typeof opts.gameName === "string" ? opts.gameName : "Imported Game";
    const archiveName = typeof opts.archiveName === "string" ? opts.archiveName : (gameName + ".zip");
    const manageUi = opts.manageUi !== false;
    const baseGameBytes = Number.isSafeInteger(opts.baseGameBytes) && opts.baseGameBytes > 0 ? opts.baseGameBytes : 0;
    const baseGameFileCount = Number.isSafeInteger(opts.baseGameFileCount) && opts.baseGameFileCount > 0 ? opts.baseGameFileCount : 0;
    const skipExistingFilePaths = new Set(Array.isArray(opts.skipExistingFilePaths)
      ? opts.skipExistingFilePaths.map((path) => normalizePath(path))
      : []);
    let fileEntries = Array.isArray(entries) ? entries : [];
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
    const resolvedMirrorSource = incomingMirrorSource || (
      importMode === "replace" && existingGame ? existingGame.mirrorSource || null : null
    );

    try {
      const processedEntries = [];
      const brotliDecodedPaths = new Set();
      const seenPaths = new Map();
      let launcherMetadata = { name: "", thumbnailDataUrl: "" };

      setWorkProgress("Processing entries", 0, fileEntries.length);
      const trackProgressTree = opts.trackProgressTree === true;
      if (trackProgressTree) {
        setWorkProgressTree(0, fileEntries.length, "", fileEntries.map((entry) => entry.path));
      }

      for (let idx = 0; idx < fileEntries.length; idx++) {
        const entry = fileEntries[idx];
        let entryBytes = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
        let path = normalizePath(entry.path || "");
        if (trackProgressTree) setWorkProgressTree(idx, fileEntries.length, entry.path);
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

        if (skipExistingFilePaths.has(path) && !brotliDecoded) {
          entry.bytes = null;
          entryBytes = null;
          bytes = null;
          if (trackProgressTree) setWorkProgressTree(idx + 1, fileEntries.length, path);
          continue;
        }
        if (seenPaths.has(path)) {
          const existingIndex = seenPaths.get(path);
          // Prefer decoded bytes when the archive also contains the original .br asset.
          if (brotliDecoded && typeof existingIndex === "number") {
            processedEntries[existingIndex].bytes = null;
            processedEntries[existingIndex] = {
              path,
              bytes,
              originalPath: entry.path
            };
          }
          entry.bytes = null;
          entryBytes = null;
          bytes = null;
          if (trackProgressTree) setWorkProgressTree(idx + 1, fileEntries.length, path);
          continue;
        }

        seenPaths.set(path, processedEntries.length);
        processedEntries.push({
          path,
          bytes,
          originalPath: entry.path
        });
        entry.bytes = null;
        entryBytes = null;
        bytes = null;
        if (trackProgressTree) setWorkProgressTree(idx + 1, fileEntries.length, path);

        if ((idx + 1) % 50 === 0) {
          setWorkProgress("Processing entries", idx + 1, fileEntries.length);
        }
      }

      // Parser entries hold another reference to each payload, so discard them before optimizing.
      fileEntries.length = 0;
      fileEntries = null;
      const brotliReplacementMap = buildBrotliReplacementMap(brotliDecodedPaths);
      // Resolve filenames after the compressed names have been normalized.
      launcherMetadata = detectLauncherMetadata(processedEntries);

      setWorkProgress("Optimizing game assets", 0, 0);
      if (trackProgressTree) {
        setWorkProgressTree(0, processedEntries.length, "", processedEntries.map((entry) => entry.path));
      }
      for (let idx = 0; idx < processedEntries.length; idx += 1) {
        const entry = processedEntries[idx];
        if (trackProgressTree) setWorkProgressTree(idx, processedEntries.length, entry.path);
        const transformed = applyCurrentExtractorTransformations(entry.path, entry.bytes, {
          brotliDecodedPaths,
          brotliReplacementMap
        });
        entry.bytes = transformed.bytes;
        entry.transformations = transformed.transformations;
        if (trackProgressTree) setWorkProgressTree(idx + 1, processedEntries.length, entry.path);
      }

      await applyPreLaunchTransformations(processedEntries);
      if (trackProgressTree) setWorkProgressTree(processedEntries.length, processedEntries.length, "");
      let processedGameBytes = baseGameBytes;
      for (const entry of processedEntries) {
        processedGameBytes = addGameImportBytes(processedGameBytes, entry.bytes.byteLength);
      }
      let oversizedImportConfirmed = opts.skipLargeWarning === true;
      if (isGameImportOversized(processedGameBytes) && !oversizedImportConfirmed) {
        const proceed = await askLargeGameImportDecision(gameName, processedGameBytes);
        if (!proceed) {
          log("Import canceled after the large-game warning.", "info");
          return;
        }
        oversizedImportConfirmed = true;
      }

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

      const autoThumbnailDataUrl = findAutoThumbnailDataUrl(processedEntries);
      const effectiveName = String(launcherMetadata.name || preservedName || gameName || "Imported Game").trim() || gameName || "Imported Game";
      const gameRecord = {
        id: gameId,
        name: effectiveName,
        zipName: archiveName,
        importedAt: Date.now(),
        extractorVersion: CURRENT_EXTRACTOR_VERSION,
        sortOrder: Number.isFinite(preservedSortOrder) ? preservedSortOrder : getNextSortOrder(),
        fileCount: existingGameId ? baseGameFileCount : baseGameFileCount + processedEntries.length,
        totalBytes: 0,
        htmlEntries,
        entryPath: chooseBestEntryPath(htmlEntries, ""),
        thumbnailDataUrl: preservedThumbnail || launcherMetadata.thumbnailDataUrl || autoThumbnailDataUrl,
        githubSource: resolvedGithubSource,
        mirrorSource: resolvedMirrorSource,
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
      if (trackProgressTree) {
        setWorkProgressTree(0, processedEntries.length, "", processedEntries.map((entry) => entry.path));
      }

      for (const entry of processedEntries) {
        if (trackProgressTree) setWorkProgressTree(processed, processedEntries.length, entry.path);
        const entryBytes = entry.bytes;
        const transformations = entry.transformations;

        const blob = new Blob([entryBytes], { type: mimeFromPath(entry.path) });
        totalBytes = addGameImportBytes(totalBytes, blob.size);

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
        if (trackProgressTree) setWorkProgressTree(processed, processedEntries.length, entry.path);
        // IndexedDB has its Blob now; avoid retaining every source buffer until the import ends.
        entry.bytes = null;
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

      if (importMode === "replace" && existingGame) {
        log("Replaced game \"" + (existingGame.name || gameRecord.name) + "\" (" + formatBytes(totalBytes) + ")");
      } else {
        log("Saved game \"" + gameRecord.name + "\" (" + formatBytes(totalBytes) + ")");
        if (opts.suppressEdit !== true) openGameEditModal(gameId);
      }
    } finally {
      if (manageUi) {
        setActionButtonsDisabled(false);
      }
    }
  }
