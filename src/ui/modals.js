"use strict";
function openWrongZipTypeModal(message, title) {
  wrongZipTypeTitle.textContent = title || (message && message.startsWith("This looks like") ? "Wrong ZIP Type" : "Import Error");
  wrongZipTypeMessage.textContent = message || "This ZIP cannot be imported here.";
  wrongZipTypeModal.classList.add("open");
  wrongZipTypeModal.setAttribute("aria-hidden", "false");
  wrongZipTypeOkButton.focus();
}

function closeWrongZipTypeModal() {
  wrongZipTypeModal.classList.remove("open");
  wrongZipTypeModal.setAttribute("aria-hidden", "true");
  wrongZipTypeTitle.textContent = "Wrong ZIP Type";
}

function closeSaveImportModal() {
  saveImportModal.classList.remove("open");
  saveImportModal.setAttribute("aria-hidden", "true");
  state.saveImportDraft = null;
}

function openSaveImportModal(parsed) {
  // Unity /idbfs games
  const unityRows = [];
  for (const [zipSlug, entry] of parsed.gameEntries) {
    const expectedHash = computeUnityHash(zipSlug);
    let autoGameId = null;
    for (const game of state.gamesById.values()) {
      if (!game.zipName) continue;
      const slug = zipSlugFromZipName(game.zipName);
      if (slug === zipSlug || computeUnityHash(slug) === expectedHash) {
        autoGameId = game.id;
        break;
      }
    }
    unityRows.push({
      zipSlug,
      sourceHash: entry.hash,
      fileCount: entry.fileCount,
      records: entry.records,
      autoGameId,
      action: autoGameId ? ("auto:" + autoGameId) : "raw"
    });
  }

  // Other IDBs
  const otherDbRows = (parsed.otherDbs || []).map((db) => ({
    dbName: db.dbName,
    stores: db.stores,
    action: "import"
  }));

  const lsCount = parsed.localStorageData ? Object.keys(parsed.localStorageData).length : 0;
  state.saveImportDraft = {
    localStorageAction: parsed.localStorageData ? "import" : null,
    localStorageData: parsed.localStorageData,
    localStorageCount: lsCount,
    unityRows,
    otherDbRows
  };

  const totalSections = (parsed.localStorageData ? 1 : 0) + unityRows.length + otherDbRows.length;
  saveImportSummary.textContent = "Save ZIP contains " + totalSections + " section(s). Choose what to do with each.";
  renderSaveImportList();
  saveImportModal.classList.add("open");
  saveImportModal.setAttribute("aria-hidden", "false");
  saveImportConfirmButton.focus();
}

function closeGenericChoiceModal() {
    genericChoiceModal.classList.remove("open");
    genericChoiceModal.setAttribute("aria-hidden", "true");
    const resolver = state.genericChoiceResolver;
    state.genericChoiceResolver = null;
    return resolver;
  }

function askImportConflictDecision(existingGame, incomingFileName) {
    return new Promise((resolve) => {
      const existingName = existingGame && existingGame.name ? String(existingGame.name) : "this game";
      const incoming = String(incomingFileName || "this ZIP");
      genericChoiceTitle.textContent = "Game Already Exists";
      genericChoiceMessage.textContent =
        "\"" + existingName + "\" is already in your library. Do you want to replace the existing copy or import \"" +
        incoming +
        "\" as a separate game?";
      genericChoiceOptionAButton.textContent = "Import Separately";
      genericChoiceOptionBButton.textContent = "Replace Contents";
      state.genericChoiceResolver = resolve;
      genericChoiceModal.classList.add("open");
      genericChoiceModal.setAttribute("aria-hidden", "false");
      genericChoiceOptionBButton.focus();
    });
  }

function askExportDecision(game) {
    return new Promise((resolve) => {
      const name = game && game.name ? String(game.name) : "this game";
      genericChoiceTitle.textContent = "Export Individual Game";
      genericChoiceMessage.textContent = "How would you like to export \"" + name + "\"? You can export the files exactly as they are currently saved, or try to revert automatic changes made during import (like Ruffle Flash emulation).";
      genericChoiceOptionAButton.textContent = "Standard Export";
      genericChoiceOptionBButton.textContent = "Reverted Export";
      state.genericChoiceResolver = resolve;
      genericChoiceModal.classList.add("open");
      genericChoiceModal.setAttribute("aria-hidden", "false");
      genericChoiceOptionAButton.focus();
    });
  }

function askSharedArrayBufferDecision() {
    return new Promise((resolve) => {
      genericChoiceTitle.textContent = "SharedArrayBuffer Detected";
      genericChoiceMessage.textContent =
        "This game uses SharedArrayBuffer, which is not supported on the file:// protocol. " +
        "It may fail to launch or behave incorrectly in the offline launcher.\n\n" +
        "Import anyway?";
      genericChoiceOptionAButton.textContent = "Don't Import";
      genericChoiceOptionBButton.textContent = "Import Anyway";
      state.genericChoiceResolver = resolve;
      genericChoiceModal.classList.add("open");
      genericChoiceModal.setAttribute("aria-hidden", "false");
      genericChoiceOptionAButton.focus();
    });
  }

function closeGithubImportModal() {
    githubImportModal.classList.remove("open");
    githubImportModal.setAttribute("aria-hidden", "true");
    const resolver = state.githubImportResolver;
    state.githubImportResolver = null;
    return resolver;
  }

function askGithubImportSource() {
    return new Promise((resolve) => {
      githubImportInput.value = "";
      state.githubImportResolver = resolve;
      githubImportModal.classList.add("open");
      githubImportModal.setAttribute("aria-hidden", "false");
      githubImportInput.focus();
    });
  }

function closeReplaceTargetModal() {
    replaceTargetModal.classList.remove("open");
    replaceTargetModal.setAttribute("aria-hidden", "true");
    state.replaceTargetSelectedId = "";
  }

function openReplaceTargetGameModal() {
    state.replaceTargetSelectedId = state.selectedGameId && state.gamesById.has(state.selectedGameId)
      ? state.selectedGameId
      : "";
    renderReplaceTargetList();
    replaceTargetModal.classList.add("open");
    replaceTargetModal.setAttribute("aria-hidden", "false");
    replaceTargetChooseButton.focus();
  }

function closeUpdatePromptModal() {
    updatePromptModal.classList.remove("open");
    updatePromptModal.setAttribute("aria-hidden", "true");
    const resolver = state.updatePromptResolver;
    state.updatePromptResolver = null;
    return resolver;
  }

function askUpdateInstallDecision(gameName, sourceLabel, progressLabel) {
    return new Promise((resolve) => {
      updatePromptMessage.textContent =
        String(progressLabel || "") +
        "\n\n\"" + String(gameName || "Selected game") + "\" has an available update.\n" +
        "Source: " + String(sourceLabel || "unknown") + "\n\n" +
        "Do you want to update this game now?";
      state.updatePromptResolver = resolve;
      updatePromptModal.classList.add("open");
      updatePromptModal.setAttribute("aria-hidden", "false");
      updatePromptInstallButton.focus();
    });
  }

function closeExtractorMigrationModal() {
    extractorMigrationModal.classList.remove("open");
    extractorMigrationModal.setAttribute("aria-hidden", "true");
    const resolver = state.extractorMigrationResolver;
    state.extractorMigrationResolver = null;
    return resolver;
  }

function askExtractorMigrationDecision(game, analysis, fromVersion, currentVersion) {
    return new Promise((resolve) => {
      const name = game && game.name ? String(game.name) : "Selected game";
      const filesChanged = Number(analysis && analysis.filesChanged) || 0;
      const filesChecked = Number(analysis && analysis.filesChecked) || 0;
      const storedSize = formatBytes(Number(analysis && analysis.totalBytes) || 0);
      extractorMigrationMessage.textContent =
        "\"" + name + "\" was updated from launcher v" + fromVersion +
        ", and the current launcher is v" + currentVersion + ".\n\n" +
        filesChanged + "/" + filesChecked + " saved files need to be updated before launch. " +
        "The launcher can update the stored copy now, or launch the current stored files unchanged.\n\n" +
        "Stored size after update: " + storedSize + ".";
      extractorMigrationDontAsk.checked = false;
      state.extractorMigrationResolver = resolve;
      extractorMigrationModal.classList.add("open");
      extractorMigrationModal.setAttribute("aria-hidden", "false");
      extractorMigrationUpdateButton.focus();
    });
  }

function closeBundlePreviewModal() {
    bundlePreviewModal.classList.remove("open");
    bundlePreviewModal.setAttribute("aria-hidden", "true");
    const resolver = state.bundlePreviewResolver;
    state.bundlePreviewResolver = null;
    state.bundlePreviewDraft = null;
    return resolver;
  }

function closeGameEditModal(options = {}) {
    gameEditModal.classList.remove("open");
    gameEditModal.setAttribute("aria-hidden", "true");
    if (state.gameEditEditor.cropper) {
      state.gameEditEditor.cropper.destroy();
      state.gameEditEditor.cropper = null;
    }
    if (state.gameEditEditor.previewFrame) {
      cancelAnimationFrame(state.gameEditEditor.previewFrame);
      state.gameEditEditor.previewFrame = 0;
    }
    if (state.gameEditEditor.sourceUrl) {
      URL.revokeObjectURL(state.gameEditEditor.sourceUrl);
    }
    state.gameEditEditor.gameId = null;
    state.gameEditEditor.image = null;
    state.gameEditEditor.sourceUrl = null;
    gameEditCropWrap.classList.add("is-empty");
    gameEditCropImage.removeAttribute("src");
    gameEditNameInput.value = "";
    gameEditPreviewTitle.textContent = "Untitled game";
    if (gameEditPreviewBadges) {
      gameEditPreviewBadges.innerHTML = "";
    }
    gameEditPreviewThumb.style.backgroundImage = "";
    gameEditPreviewThumb.classList.add("preview-empty");
    gameEditImageInput.value = "";
    if (!options.skipTutorial && typeof onTutorialEditClosed === "function") {
      onTutorialEditClosed();
    }
  }

function resolveEditedMetadataCoverPath(metadataPath, coverPath) {
    const rawCoverPath = String(coverPath || "").trim();
    if (!rawCoverPath || rawCoverPath.startsWith("/") || rawCoverPath.includes("\\") || rawCoverPath.includes(":")) {
      return "";
    }
    const normalized = normalizePath(rawCoverPath);
    if (!normalized || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      return "";
    }
    return normalized;
  }

async function readManagedGameMetadataRecord(record) {
    if (!record || !record.blob || typeof record.blob.text !== "function") {
      return null;
    }
    try {
      const data = JSON.parse(await record.blob.text());
      if (!data || data._cbgames !== GAME_EDITOR_METADATA_MARKER || !data.launcher || typeof data.launcher !== "object") {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

async function getEditedGameMetadataLocation(gameId) {
    const files = await getAllFilesForGame(gameId);
    const managedRecords = [];
    const occupiedPaths = new Set();
    for (const record of files) {
      const path = normalizePath(record.path || "");
      occupiedPaths.add(path);
      if (!/launcher\.json$/i.test(path)) {
        continue;
      }
      const metadata = await readManagedGameMetadataRecord(record);
      if (metadata) {
        managedRecords.push({ record, metadata });
      }
    }

    if (managedRecords.length) {
      const managed = managedRecords[0];
      const metadataPath = normalizePath(managed.record.path);
      const previousCoverPath = resolveEditedMetadataCoverPath(metadataPath, managed.metadata.launcher.cover);
      return { metadataPath, previousCoverPath, occupiedPaths };
    }

    if (!occupiedPaths.has("launcher.json")) {
      return { metadataPath: "launcher.json", previousCoverPath: "", occupiedPaths };
    }

    let suffix = 1;
    while (suffix < 1000) {
      const directory = suffix === 1 ? "__cbgames-launcher" : "__cbgames-launcher-" + suffix;
      const metadataPath = directory + "/launcher.json";
      if (!occupiedPaths.has(metadataPath)) {
        return { metadataPath, previousCoverPath: "", occupiedPaths };
      }
      suffix += 1;
    }
    throw new Error("Could not find a safe path for launcher recovery metadata.");
  }

async function createPngThumbnailRecord(gameId, thumbnailDataUrl, path) {
    if (!thumbnailDataUrl) {
      return null;
    }
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Could not read the current game thumbnail."));
      image.src = thumbnailDataUrl;
    });
    const sourceWidth = Number(image.naturalWidth) || Number(image.width);
    const sourceHeight = Number(image.naturalHeight) || Number(image.height);
    if (!sourceWidth || !sourceHeight) {
      throw new Error("The current game thumbnail has no image dimensions.");
    }
    const scale = Math.min(1, 1024 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not prepare the thumbnail for storage.");
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const parsed = parseDataUrlToBytes(canvas.toDataURL("image/png"));
    if (!parsed || parsed.mime !== "image/png" || !parsed.bytes.length) {
      throw new Error("Could not encode the game thumbnail as PNG.");
    }
    const blob = new Blob([parsed.bytes], { type: "image/png" });
    return {
      gameId,
      path,
      size: blob.size,
      type: blob.type,
      blob,
      transformations: []
    };
  }

async function persistEditedGameRecoveryFiles(game) {
    const location = await getEditedGameMetadataLocation(game.id);
    const metadataDirectory = normalizePath(location.metadataPath).split("/").slice(0, -1).join("/");
    const previousCoverName = location.previousCoverPath.split("/").pop() || "";
    const safePreviousCoverPath = location.previousCoverPath &&
      /^thumbnail(?:-[0-9]+)?\.png$/i.test(previousCoverName) &&
      location.previousCoverPath.startsWith(metadataDirectory ? metadataDirectory + "/" : "")
      ? location.previousCoverPath
      : "";
    const coverFileName = game.thumbnailDataUrl
      ? (() => {
          let suffix = 1;
          while (suffix < 1000) {
            const name = suffix === 1 ? "thumbnail.png" : "thumbnail-" + suffix + ".png";
            const path = normalizePath(metadataDirectory ? metadataDirectory + "/" + name : name);
            if (!location.occupiedPaths.has(path) || path === safePreviousCoverPath) {
              return name;
            }
            suffix += 1;
          }
          throw new Error("Could not find a safe filename for the game thumbnail.");
        })()
      : "";
    const coverPath = coverFileName
      ? normalizePath(metadataDirectory ? metadataDirectory + "/" + coverFileName : coverFileName)
      : "";
    const coverRecord = coverPath
      ? await createPngThumbnailRecord(game.id, game.thumbnailDataUrl, coverPath)
      : null;

    if (coverRecord) {
      await putFileRecord(coverRecord);
    }

    const metadata = {
      _cbgames: GAME_EDITOR_METADATA_MARKER,
      launcher: {
        name: String(game.name || "")
      }
    };
    if (coverFileName) {
      metadata.launcher.cover = coverPath;
    }
    const metadataBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
    await putFileRecord({
      gameId: game.id,
      path: location.metadataPath,
      size: metadataBlob.size,
      type: metadataBlob.type,
      blob: metadataBlob,
      transformations: []
    });

    if (safePreviousCoverPath && safePreviousCoverPath !== coverPath) {
      await deleteFileRecord(game.id, safePreviousCoverPath);
    }

    const files = await getAllFilesForGame(game.id);
    game.fileCount = files.length;
    game.totalBytes = files.reduce((total, file) => total + (Number(file.size) || 0), 0);
    await putGame(game);
  }

async function saveGameEditChanges() {
    const gameId = state.gameEditEditor.gameId;
    const gameBeforeSave = gameId ? state.gamesById.get(gameId) : null;
    const previousName = gameBeforeSave ? String(gameBeforeSave.name || "") : "";
    const nameChanged = Boolean(gameBeforeSave) &&
      String(gameEditNameInput.value || "").trim() !== previousName;
    if (!(await saveGameEditName({ silent: true, skipRecoveryFiles: true }))) {
      return;
    }
    const game = gameId ? state.gamesById.get(gameId) : null;
    if (!game) {
      log("Select a game before saving changes.", "error");
      return;
    }

    const cropper = state.gameEditEditor.cropper;
    const previousThumbnailDataUrl = game.thumbnailDataUrl;
    let updatedThumbnail = false;
    if (cropper) {
      const cropped = cropper.getCroppedCanvas({
        width: 1024,
        height: 1024,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high"
      });
      if (!cropped) {
        log("Could not crop this image.", "error");
        return;
      }
      game.thumbnailDataUrl = cropped.toDataURL("image/jpeg", 0.9);
      state.gamesById.set(game.id, game);
      await putGame(game);
      updatedThumbnail = true;
    }

    if (updatedThumbnail || nameChanged) {
      try {
        await persistEditedGameRecoveryFiles(game);
      } catch (error) {
        console.error(error);
        game.name = previousName;
        game.thumbnailDataUrl = previousThumbnailDataUrl;
        state.gamesById.set(game.id, game);
        await putGame(game).catch(() => {});
        renderGameOptions(game.id);
        updateSelectedGameInfo(game);
        log("Could not save the game's recovery metadata.", "error");
        return;
      }
    }
    renderGameCards();
    closeGameEditModal({ skipTutorial: true });
    if (typeof onTutorialEditSaved === "function") {
      onTutorialEditSaved();
    }
    log("Saved changes for " + game.name + ".");
  }

async function removeGameEditImage() {
    if (!(await saveGameEditName({ silent: true, skipRecoveryFiles: true }))) {
      return;
    }
    const gameId = state.gameEditEditor.gameId;
    const game = gameId ? state.gamesById.get(gameId) : null;
    if (!game) {
      return;
    }
    const previousThumbnailDataUrl = game.thumbnailDataUrl;
    game.thumbnailDataUrl = "";
    state.gamesById.set(game.id, game);
    await putGame(game);
    try {
      await persistEditedGameRecoveryFiles(game);
    } catch (error) {
      console.error(error);
      game.thumbnailDataUrl = previousThumbnailDataUrl;
      state.gamesById.set(game.id, game);
      await putGame(game).catch(() => {});
      log("Could not save the game's recovery metadata.", "error");
      return;
    }
    renderGameCards();
    closeGameEditModal();
    log("Removed game image for " + game.name + ".");
  }

function openGameEditModal(gameId) {
    if (!gameId || !state.gamesById.has(gameId)) {
      return;
    }
    hideOpsModal(true);
    const game = state.gamesById.get(gameId);
    state.gameEditEditor.gameId = gameId;
    if (state.gameEditEditor.cropper) {
      state.gameEditEditor.cropper.destroy();
      state.gameEditEditor.cropper = null;
    }
    state.gameEditEditor.image = null;
    if (state.gameEditEditor.sourceUrl) {
      URL.revokeObjectURL(state.gameEditEditor.sourceUrl);
    }
    state.gameEditEditor.sourceUrl = null;
    if (game && typeof game.thumbnailDataUrl === "string" && game.thumbnailDataUrl) {
      setGameEditCropSource(game.thumbnailDataUrl);
    } else {
      setGameEditCropSource("");
    }
    gameEditNameInput.value = String(game.name || "");
    gameEditPreviewTitle.textContent = String(game.name || "Untitled game");
    if (gameEditPreviewBadges) {
      gameEditPreviewBadges.innerHTML = buildGameBadgeItemsMarkup(game, true);
    }
    gameEditModal.classList.add("open");
    gameEditModal.setAttribute("aria-hidden", "false");
    if (typeof onTutorialEditOpened === "function") {
      onTutorialEditOpened();
    }
  }

async function saveGameEditName(options = {}) {
    const silent = Boolean(options.silent);
    const gameId = state.gameEditEditor.gameId;
    const game = gameId ? state.gamesById.get(gameId) : null;
    if (!game) {
      if (!silent) {
        log("Select a game before renaming.", "error");
      }
      return false;
    }

    const nextName = String(gameEditNameInput.value || "").trim();
    if (!nextName) {
      log("Game name cannot be empty.", "error");
      gameEditNameInput.focus();
      return false;
    }
    if (nextName === String(game.name || "")) {
      return true;
    }

    const previousName = String(game.name || "");
    const previousThumbnailDataUrl = game.thumbnailDataUrl;
    game.name = nextName;
    state.gamesById.set(game.id, game);

    try {
      await putGame(game);
      if (!options.skipRecoveryFiles) {
        await persistEditedGameRecoveryFiles(game);
      }
      renderGameOptions(game.id);
      updateSelectedGameInfo(game);
      if (!silent) {
        log("Renamed game to " + game.name + ".");
      }
      return true;
    } catch (error) {
      console.error(error);
      game.name = previousName;
      game.thumbnailDataUrl = previousThumbnailDataUrl;
      state.gamesById.set(game.id, game);
      await putGame(game).catch(() => {});
      log("Could not save game name.", "error");
      return false;
    }
  }

function loadGameEditImageSource(file) {
    if (!file || !file.type.startsWith("image/")) {
      log("Please choose an image file for the game image.", "error");
      return;
    }
    if (state.gameEditEditor.sourceUrl) {
      URL.revokeObjectURL(state.gameEditEditor.sourceUrl);
    }
    const objectUrl = URL.createObjectURL(file);
    state.gameEditEditor.sourceUrl = objectUrl;
    setGameEditCropSource(objectUrl);
  }
