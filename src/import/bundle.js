"use strict";
function normalizeBundleGameRecord(record) {
    const source = record && typeof record === "object" ? record : {};
    const explicitHtmlEntries = Array.isArray(source.htmlEntries)
      ? source.htmlEntries.map((v) => normalizePath(v)).filter(Boolean)
      : [];
    const derivedHtmlEntries = Array.isArray(source.files)
      ? source.files
          .map((item) => normalizePath(item && item.path ? item.path : ""))
          .filter((path) => /\.html?$/i.test(path))
      : [];
    const htmlEntries = explicitHtmlEntries.length ? explicitHtmlEntries : derivedHtmlEntries;
    const normalized = {
      id: typeof source.id === "string" && source.id ? source.id : makeId(),
      name: typeof source.name === "string" && source.name ? source.name : "Imported Game",
      zipName: typeof source.zipName === "string" && source.zipName ? source.zipName : "Imported Bundle",
      importedAt: Number(source.importedAt) || Date.now(),
      extractorVersion: Number(source.extractorVersion) || 1,
      sortOrder: Number.isFinite(Number(source.sortOrder)) ? Number(source.sortOrder) : Number.MAX_SAFE_INTEGER,
      fileCount: Number(source.fileCount) || 0,
      totalBytes: Number(source.totalBytes) || 0,
      htmlEntries,
      entryPath: typeof source.entryPath === "string" ? normalizePath(source.entryPath) : "",
      thumbnailDataUrl: typeof source.thumbnailDataUrl === "string" ? source.thumbnailDataUrl : "",
      githubSource: normalizeGithubSource(source.githubSource),
      unityDetected: Boolean(source.unityDetected) || detectUnityByPaths(
        Array.isArray(source.files) ? source.files.map((item) => normalizePath(item && item.path ? item.path : "")) : []
      ),
      flashDetected: Boolean(source.flashDetected) || detectFlashByPaths(
        Array.isArray(source.files) ? source.files.map((item) => normalizePath(item && item.path ? item.path : "")) : []
      )
    };
    normalized.entryPath = chooseBestEntryPath(normalized.htmlEntries, normalized.entryPath);
    return normalized;
  }

async function exportGamesBundle(games, progressCallback) {
    const list = Array.isArray(games) ? games.filter(Boolean) : [];
    if (!list.length) {
      throw new Error("No saved games to export.");
    }
    const zipEntries = [];
    const manifest = {
      format: "cbgames-zip-v2",
      createdAt: Date.now(),
      games: []
    };
    let processedGames = 0;
    for (const game of list) {
      const files = await getAllFilesForGame(game.id);
      const gameFolder = "games/" + encodeURIComponent(game.id);
      const manifestGame = {
        id: game.id,
        name: game.name,
        zipName: game.zipName,
        importedAt: game.importedAt,
        extractorVersion: Number(game.extractorVersion) || 1,
        sortOrder: Number.isFinite(Number(game.sortOrder)) ? Number(game.sortOrder) : Number.MAX_SAFE_INTEGER,
        fileCount: game.fileCount,
        totalBytes: game.totalBytes,
        htmlEntries: Array.isArray(game.htmlEntries) ? game.htmlEntries : [],
        entryPath: game.entryPath || "",
        githubSource: normalizeGithubSource(game.githubSource),
        unityDetected: Boolean(game.unityDetected),
        flashDetected: Boolean(game.flashDetected),
        files: []
      };
      if (typeof game.thumbnailDataUrl === "string" && game.thumbnailDataUrl) {
        const thumb = parseDataUrlToBytes(game.thumbnailDataUrl);
        if (thumb && thumb.bytes.length) {
          const thumbPath = gameFolder + "/thumbnail" + extensionFromMime(thumb.mime);
          zipEntries.push({
            path: thumbPath,
            bytes: thumb.bytes
          });
          manifestGame.thumbnail = {
            path: thumbPath,
            type: thumb.mime
          };
        }
      }
      for (const file of files) {
        const bytes = new Uint8Array(await file.blob.arrayBuffer());
        const zipPath = gameFolder + "/files/" + normalizePath(file.path);
        zipEntries.push({
          path: zipPath,
          bytes
        });
        const manifestFile = {
          path: normalizePath(file.path),
          type: file.type || mimeFromPath(file.path),
          size: Number(file.size) || bytes.byteLength,
          zipPath
        };
        if (Array.isArray(file.transformations) && file.transformations.length) {
          manifestFile.transformations = file.transformations;
        }
        manifestGame.files.push(manifestFile);
      }
      manifest.games.push(manifestGame);
      processedGames += 1;
      if (typeof progressCallback === "function") {
        progressCallback(processedGames, list.length);
      }
    }

    const manifestBytes = encodeUtf8(JSON.stringify(manifest));
    zipEntries.unshift({
      path: "bundle.json",
      bytes: manifestBytes
    });

    return createZipStoreArchive(zipEntries);
  }

async function exportAllGamesBundle(progressCallback) {
    const games = await getAllGames();
    return exportGamesBundle(games, progressCallback);
  }

async function downloadAllGamesBundle() {
    setActionButtonsDisabled(true);
    try {
      setWorkProgress("Preparing game bundle", 0, 0);
      log("Preparing game bundle...");
      const exportStart = performance.now();
      const bundleZip = await exportAllGamesBundle((current, total) => {
        const etaText = formatEtaSeconds(estimateEtaSeconds(exportStart, current, total));
        setWorkProgress(
          "Reading saved games",
          current,
          total,
          { currentText: String(current), totalText: String(total), etaText }
        );
      });
      setWorkProgress("Writing bundle file", 1, 1);
      const filename = "cbgames-bundle.zip";
      const url = URL.createObjectURL(bundleZip);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      log("Exported games to " + filename + ".");
    } finally {
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }
  }

async function downloadGameWithTransformationsReverted(game) {
    setActionButtonsDisabled(true);
    try {
      if (!game) {
        throw new Error("No game selected.");
      }
      setWorkProgress("Preparing game export", 0, 0);
      log(`Exporting game "${game.name}" with transformation info...`);
      const files = await getAllFilesForGame(game.id);
      
      const zipEntries = [];
      let revertedFileCount = 0;
      for (const file of files) {
        const rawBytes = new Uint8Array(await file.blob.arrayBuffer());
        const reversedBytes = reverseFileTransformations(rawBytes, file.transformations);
        if (reversedBytes !== rawBytes) {
          revertedFileCount += 1;
        }
        zipEntries.push({
          path: file.path,
          bytes: reversedBytes
        });
      }
      
      const transformationMetadata = {
        gameId: game.id,
        gameName: game.name,
        extractorVersion: game.extractorVersion || 1,
        exportedAt: Date.now(),
        exportMode: "reverted-transformations",
        revertedFileCount,
        reversibleTransformationCount: countReversibleTransformations(files),
        filesWithTransformations: files
          .filter(f => f.transformations && f.transformations.length > 0)
          .map(f => ({
            path: f.path,
            transformations: f.transformations
          }))
      };
      
      zipEntries.push({
        path: ".cbgames-metadata.json",
        bytes: new TextEncoder().encode(JSON.stringify(transformationMetadata, null, 2))
      });
      
      const bundleZip = createZipStoreArchive(zipEntries);
      const filename = game.name.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase() + "-exported.zip";
      const url = URL.createObjectURL(new Blob([bundleZip], { type: "application/zip" }));
      
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      log(`Exported "${game.name}" to ${filename}; reverted ${revertedFileCount} transformed files.`);
    } finally {
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }
  }

async function downloadGameStandard(game) {
    setActionButtonsDisabled(true);
    try {
      if (!game) {
        throw new Error("No game selected.");
      }
      setWorkProgress("Preparing game export", 0, 0);
      log(`Exporting game "${game.name}"...`);
      const files = await getAllFilesForGame(game.id);
      
      const zipEntries = [];
      for (const file of files) {
        const rawBytes = new Uint8Array(await file.blob.arrayBuffer());
        zipEntries.push({
          path: file.path,
          bytes: rawBytes
        });
      }
      
      const bundleZip = createZipStoreArchive(zipEntries);
      const filename = game.name.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".zip";
      const url = URL.createObjectURL(new Blob([bundleZip], { type: "application/zip" }));
      
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      log(`Exported "${game.name}" to ${filename}.`);
    } finally {
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }
  }

async function pickBundleFile() {
    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: false,
          types: [
            {
              description: "CBGames bundle",
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
        await importBundleFile(file);
      } catch (error) {
        if (error && error.name === "AbortError") {
          log("Bundle import canceled.");
          return;
        }
        console.error(error);
        log("Bundle import failed: " + (error.message || String(error)), "error");
      }
      return;
    }

    bundleInput.value = "";
    bundleInput.click();
  }

async function parseBundlePreviewData(file) {
    log("Reading bundle: " + file.name);
    const buffer = await readFileArrayBufferWithProgress(file, "Reading bundle");
    let parsedZip;
    try {
      parsedZip = parseZipArchive(buffer);
    } catch {
      throw new Error("Bundle import only supports .zip files.");
    }
    const entryByPath = new Map(parsedZip.entries.map((entry) => [normalizePath(entry.path), entry]));
    const manifestEntry = entryByPath.get("bundle.json");
    if (!manifestEntry) {
      if (entryByPath.has("manifest.json")) {
        const mEntry = entryByPath.get("manifest.json");
        try {
          const mBytes = await extractEntryBytes(parsedZip, mEntry);
          const mData = JSON.parse(decodeUtf8(mBytes));
          if (mData && (mData.version === "cbgames-save-v1" || mData.version === "cbgames-save-v2")) {
            throw new Error("This looks like a Save Data ZIP. Use 'Import Saves' to import it.");
          }
        } catch (e) {
          if (e.message && e.message.startsWith("This looks like")) throw e;
        }
      }
      const htmlCount = [...entryByPath.keys()].filter((p) => /\.html?$/i.test(p)).length;
      if (htmlCount > 0) {
        throw new Error("This looks like a Game ZIP. Use 'Import Game' to import it.");
      }
      throw new Error("Bundle ZIP missing bundle.json.");
    }
    const manifestBytes = await extractEntryBytes(parsedZip, manifestEntry);
    let bundle;
    try {
      bundle = JSON.parse(decodeUtf8(manifestBytes));
    } catch {
      throw new Error("Invalid bundle JSON inside ZIP.");
    }
    if (!bundle || bundle.format !== "cbgames-zip-v2" || !Array.isArray(bundle.games)) {
      throw new Error("Unsupported backup format.");
    }

    const previewGames = [];
    let totalFiles = 0;
    let totalBytes = 0;
    for (let index = 0; index < bundle.games.length; index += 1) {
      const rawGame = bundle.games[index];
      const normalizedGame = normalizeBundleGameRecord({
        ...rawGame,
        thumbnailDataUrl: ""
      });
      const fileList = Array.isArray(rawGame && rawGame.files) ? rawGame.files : [];
      let missingPayloadCount = 0;
      let computedBytes = 0;
      for (const fileInfo of fileList) {
        if (!fileInfo || typeof fileInfo !== "object") {
          continue;
        }
        const zipPath = normalizePath(fileInfo.zipPath || "");
        if (!zipPath || !entryByPath.has(zipPath)) {
          missingPayloadCount += 1;
        }
        const rawSize = Number(fileInfo.size);
        if (Number.isFinite(rawSize) && rawSize > 0) {
          computedBytes += rawSize;
        }
      }
      const fileCount = fileList.length;
      const totalGameBytes = computedBytes || Number(normalizedGame.totalBytes) || 0;
      totalFiles += fileCount;
      totalBytes += totalGameBytes;

      const existingById = normalizedGame.id ? state.gamesById.get(normalizedGame.id) : null;
      const nameConflicts = getBundleNameConflicts(normalizedGame.name || "");
      const conflictGame = existingById || nameConflicts[0] || null;
      let thumbnailDataUrl = "";
      if (rawGame && rawGame.thumbnail && typeof rawGame.thumbnail.path === "string") {
        const thumbPath = normalizePath(rawGame.thumbnail.path);
        const thumbEntry = entryByPath.get(thumbPath);
        if (thumbEntry) {
          try {
            const thumbBytes = await extractEntryBytes(parsedZip, thumbEntry);
            const thumbMime = typeof rawGame.thumbnail.type === "string" && rawGame.thumbnail.type
              ? rawGame.thumbnail.type
              : mimeFromPath(thumbPath);
            thumbnailDataUrl = "data:" + thumbMime + ";base64," + bytesToBase64(thumbBytes);
          } catch {
            thumbnailDataUrl = "";
          }
        }
      }
      let defaultMode = "import";
      if (missingPayloadCount > 0) {
        defaultMode = "skip";
      } else if (existingById) {
        defaultMode = "replace";
      } else if (nameConflicts.length) {
        defaultMode = "rename";
      }

      previewGames.push({
        index,
        sourceId: typeof rawGame.id === "string" ? rawGame.id : "",
        rawGame,
        normalizedGame,
        fileCount,
        totalBytes: totalGameBytes,
        missingPayloadCount,
        conflictGame,
        canReplace: Boolean(conflictGame),
        thumbnailDataUrl,
        defaultMode
      });
    }

    return {
      fileName: file.name,
      parsedZip,
      entryByPath,
      games: previewGames,
      totalFiles,
      totalBytes
    };
  }

async function executeBundleImportPlan(previewData, planGames) {
    const selected = planGames.filter((item) =>
      item &&
      item.selected &&
      item.mode !== "skip" &&
      item.preview &&
      !item.preview.missingPayloadCount
    );
    if (!selected.length) {
      throw new Error("No games were selected to import.");
    }

    const usedNameKeys = new Set(
      Array.from(state.gamesById.values())
        .map((game) => normalizeGameIdentity(game.name || ""))
        .filter(Boolean)
    );
    const reservedIds = new Set(Array.from(state.gamesById.keys()));
    const metadataOut = [];
    const totalFiles = selected.reduce((sum, item) => sum + (item.preview.fileCount || 0), 0);

    let metadataImported = 0;
    setWorkProgress("Importing game metadata", 0, selected.length || 1);
    const metadataStart = performance.now();
    for (const item of selected) {
      const preview = item.preview;
      const rawGame = preview.rawGame;
      const incoming = normalizeBundleGameRecord({
        ...rawGame,
        thumbnailDataUrl: ""
      });
      const mode = item.mode;
      const replaceTarget = mode === "replace" ? preview.conflictGame : null;

      if (replaceTarget) {
        await deleteFilesByGameId(replaceTarget.id);
        incoming.id = replaceTarget.id;
        incoming.sortOrder = Number.isFinite(Number(replaceTarget.sortOrder))
          ? Number(replaceTarget.sortOrder)
          : getNextSortOrder();
        incoming.name = String(replaceTarget.name || incoming.name || "Imported Game");
      } else {
        incoming.id = chooseUniqueGameId(incoming.id, reservedIds);
        incoming.sortOrder = Number.isFinite(Number(incoming.sortOrder))
          ? Number(incoming.sortOrder)
          : getNextSortOrder();
        if (mode === "rename") {
          incoming.name = chooseUniqueGameName(incoming.name, usedNameKeys);
        } else {
          incoming.name = chooseUniqueGameName(incoming.name, usedNameKeys);
        }
      }

      if (rawGame && rawGame.thumbnail && typeof rawGame.thumbnail.path === "string") {
        const thumbPath = normalizePath(rawGame.thumbnail.path);
        const thumbEntry = previewData.entryByPath.get(thumbPath);
        if (thumbEntry) {
          const thumbBytes = await extractEntryBytes(previewData.parsedZip, thumbEntry);
          const thumbMime = typeof rawGame.thumbnail.type === "string" && rawGame.thumbnail.type
            ? rawGame.thumbnail.type
            : mimeFromPath(thumbPath);
          incoming.thumbnailDataUrl = "data:" + thumbMime + ";base64," + bytesToBase64(thumbBytes);
        } else if (replaceTarget && typeof replaceTarget.thumbnailDataUrl === "string") {
          incoming.thumbnailDataUrl = replaceTarget.thumbnailDataUrl;
        }
      } else if (replaceTarget && typeof replaceTarget.thumbnailDataUrl === "string") {
        incoming.thumbnailDataUrl = replaceTarget.thumbnailDataUrl;
      }

      await putGame(incoming);
      state.gamesById.set(incoming.id, incoming);

      metadataOut.push({
        preview,
        gameId: incoming.id
      });

      metadataImported += 1;
      if (metadataImported % 5 === 0 || metadataImported === selected.length) {
        const etaText = formatEtaSeconds(estimateEtaSeconds(metadataStart, metadataImported, selected.length || 1));
        setWorkProgress(
          "Importing game metadata",
          metadataImported,
          selected.length || 1,
          { currentText: String(metadataImported), totalText: String(selected.length || 1), etaText }
        );
      }
    }

    let importedFiles = 0;
    setWorkProgress("Importing game files", 0, totalFiles || 1);
    const filesStart = performance.now();
    for (const item of metadataOut) {
      const rawGame = item.preview.rawGame;
      const fileList = Array.isArray(rawGame && rawGame.files) ? rawGame.files : [];
      for (const fileInfo of fileList) {
        if (!fileInfo || typeof fileInfo !== "object") {
          continue;
        }
        const sourcePath = normalizePath(fileInfo.path || "");
        const zipPath = normalizePath(fileInfo.zipPath || "");
        if (!sourcePath || !zipPath) {
          continue;
        }
        const zipEntry = previewData.entryByPath.get(zipPath);
        if (!zipEntry) {
          throw new Error("Bundle missing file payload: " + zipPath);
        }
        const fileBytes = await extractEntryBytes(previewData.parsedZip, zipEntry);
        const type = typeof fileInfo.type === "string" && fileInfo.type ? fileInfo.type : mimeFromPath(sourcePath);
        const blob = new Blob([fileBytes], { type });
        await putFileRecord({
          gameId: item.gameId,
          path: sourcePath,
          size: blob.size,
          type: blob.type,
          blob,
          transformations: Array.isArray(fileInfo.transformations) && fileInfo.transformations.length
            ? fileInfo.transformations
            : undefined
        });
        importedFiles += 1;
        if (importedFiles % 25 === 0 || importedFiles === totalFiles) {
          const etaText = formatEtaSeconds(estimateEtaSeconds(filesStart, importedFiles, totalFiles || 1));
          setWorkProgress(
            "Importing game files",
            importedFiles,
            totalFiles || 1,
            { currentText: String(importedFiles), totalText: String(totalFiles || 1), etaText }
          );
        }
      }
    }

    const selectedFirst = metadataOut.length ? metadataOut[0].gameId : "";
    const preferredSelected = state.selectedGameId && state.gamesById.has(state.selectedGameId)
      ? state.selectedGameId
      : selectedFirst;

    setWorkProgress("Refreshing library", 0, 0);
    await loadLibrary(preferredSelected);
    if (preferredSelected) {
      await putSetting(SETTING_SELECTED_GAME, preferredSelected);
    }

    const skippedCount = planGames.length - selected.length;
    log(
      "Imported bundle: " +
      metadataOut.length +
      " games and " +
      importedFiles +
      " files. Skipped " +
      skippedCount +
      " games."
    );
  }

async function importBundleFile(file) {
    if (!file) {
      return;
    }

    let previewData;
    setActionButtonsDisabled(true);
    try {
      previewData = await parseBundlePreviewData(file);
      log("Bundle preview ready: " + previewData.games.length + " games.");
    } catch (error) {
      console.error(error);
      const msg = error.message || String(error);
      if (isQuotaExceededError(error)) {
        const quotaMsg = "Storage Quota Exceeded: Your browser storage is full. Please delete some existing games or free up browser disk space before importing this bundle.";
        log("Bundle import failed: Storage quota exceeded.", "error");
        openWrongZipTypeModal(quotaMsg, "Storage Quota Exceeded");
      } else if (msg.startsWith("This looks like")) {
        openWrongZipTypeModal(msg);
      } else {
        log("Bundle import failed: " + msg, "error");
      }
      return;
    } finally {
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }

    const plan = await openBundlePreviewModal(previewData);
    if (!plan || !Array.isArray(plan.games)) {
      log("Bundle import canceled.");
      return;
    }

    const planByIndex = new Map(plan.games.map((entry) => [entry.index, entry]));
    const planGames = previewData.games.map((preview) => {
      const selectedPlan = planByIndex.get(preview.index) || null;
      return {
        preview,
        selected: selectedPlan ? Boolean(selectedPlan.selected) : false,
        mode: selectedPlan ? String(selectedPlan.mode || "skip") : "skip"
      };
    });

    setActionButtonsDisabled(true);
    try {
      await executeBundleImportPlan(previewData, planGames);
    } catch (error) {
      console.error(error);
      if (isQuotaExceededError(error)) {
        const quotaMsg = "Storage Quota Exceeded: Your browser storage is full. Please delete some existing games or free up browser disk space before importing this bundle.";
        log("Bundle import failed: Storage quota exceeded.", "error");
        openWrongZipTypeModal(quotaMsg, "Storage Quota Exceeded");
      } else {
        log("Bundle import failed: " + (error.message || String(error)), "error");
      }
    } finally {
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }
  }
