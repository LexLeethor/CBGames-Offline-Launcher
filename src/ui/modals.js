"use strict";
function openWrongZipTypeModal(message) {
  wrongZipTypeMessage.textContent = message || "This ZIP cannot be imported here.";
  wrongZipTypeModal.classList.add("open");
  wrongZipTypeModal.setAttribute("aria-hidden", "false");
  wrongZipTypeOkButton.focus();
}

function closeWrongZipTypeModal() {
  wrongZipTypeModal.classList.remove("open");
  wrongZipTypeModal.setAttribute("aria-hidden", "true");
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

function closeImportConflictModal() {
    importConflictModal.classList.remove("open");
    importConflictModal.setAttribute("aria-hidden", "true");
    const resolver = state.importConflictResolver;
    state.importConflictResolver = null;
    return resolver;
  }

function askImportConflictDecision(existingGame, incomingFileName) {
    return new Promise((resolve) => {
      const existingName = existingGame && existingGame.name ? String(existingGame.name) : "this game";
      const incoming = String(incomingFileName || "this ZIP");
      importConflictMessage.textContent =
        "\"" + existingName + "\" is already in your library. Do you want to replace the existing copy or import \"" +
        incoming +
        "\" as a separate game?";
      state.importConflictResolver = resolve;
      importConflictModal.classList.add("open");
      importConflictModal.setAttribute("aria-hidden", "false");
      importConflictReplaceButton.focus();
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

function closeGameEditModal() {
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
  }

async function saveGameEditChanges() {
    if (!(await saveGameEditName({ silent: true }))) {
      return;
    }
    const gameId = state.gameEditEditor.gameId;
    const game = gameId ? state.gamesById.get(gameId) : null;
    if (!game) {
      log("Select a game before saving changes.", "error");
      return;
    }

    const cropper = state.gameEditEditor.cropper;
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
    }

    renderGameCards();
    closeGameEditModal();
    log("Saved changes for " + game.name + ".");
  }

async function removeGameEditImage() {
    if (!(await saveGameEditName({ silent: true }))) {
      return;
    }
    const gameId = state.gameEditEditor.gameId;
    const game = gameId ? state.gamesById.get(gameId) : null;
    if (!game) {
      return;
    }
    game.thumbnailDataUrl = "";
    state.gamesById.set(game.id, game);
    await putGame(game);
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

    game.name = nextName;
    state.gamesById.set(game.id, game);

    try {
      await putGame(game);
      renderGameOptions(game.id);
      updateSelectedGameInfo(game);
      if (!silent) {
        log("Renamed game to " + game.name + ".");
      }
      return true;
    } catch (error) {
      console.error(error);
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
