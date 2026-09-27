"use strict";

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
      let launcherMetadata = { name: "", thumbnailDataUrl: "" };
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
      launcherMetadata = detectLauncherMetadata(processedEntries);

      setWorkProgress("Patching Files", 0, 0);
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
      let launcherMetadata = { name: "", thumbnailDataUrl: "" };

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
          // Prefer decoded bytes when the archive also contains the original .br asset.
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
      // Resolve filenames after the compressed names have been normalized.
      launcherMetadata = detectLauncherMetadata(processedEntries);

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

      const autoThumbnailDataUrl = findAutoThumbnailDataUrl(processedEntries);
      const effectiveName = String(launcherMetadata.name || preservedName || gameName || "Imported Game").trim() || gameName || "Imported Game";
      const gameRecord = {
        id: gameId,
        name: effectiveName,
        zipName: gameName + ".zip",
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

      if (importMode === "replace" && existingGame) {
        log("Replaced game \"" + (existingGame.name || gameRecord.name) + "\" (" + formatBytes(totalBytes) + ")");
      } else {
        log("Saved game \"" + gameRecord.name + "\" (" + formatBytes(totalBytes) + ")");
        openGameEditModal(gameId);
      }
    } finally {
      if (manageUi) {
        setActionButtonsDisabled(false);
      }
    }
  }
