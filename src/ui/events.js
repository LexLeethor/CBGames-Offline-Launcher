"use strict";

entrySelect.addEventListener("change", async () => {
  const game = getSelectedGame();
  if (!game || !entrySelect.value) {
    return;
  }
  game.entryPath = entrySelect.value;
  state.gamesById.set(game.id, game);
  try {
    await putGame(game);
    selectedEntry.textContent = game.entryPath;
    log("Startup file set to " + game.entryPath);
  } catch (error) {
    console.error(error);
    log("Could not save startup file selection.", "error");
  }
});

importZipButton.addEventListener("click", pickZipFile);
selectedPlayButton.addEventListener("click", async () => {
  await launchSelectedGame();
});
selectedEditButton.addEventListener("click", () => {
  if (!state.selectedGameId) {
    return;
  }
  openGameEditModal(state.selectedGameId);
});
selectedDeleteButton.addEventListener("click", async () => {
  await deleteSelectedGame();
});
replaceZipSelectedButton.addEventListener("click", async () => {
  try {
    await replaceGameWithZipFlow();
  } catch (error) {
    console.error(error);
    log("Replace import failed: " + (error.message || String(error)), "error");
  }
});

openOpsModalButton.addEventListener("click", showOpsModal);
  openHowToModalButton.addEventListener("click", showHowToModal);
  closeOpsModalButton.addEventListener("click", () => {
    hideOpsModal(false);
  });
  closeHowToModalButton.addEventListener("click", hideHowToModal);
  opsModal.addEventListener("click", (event) => {
    if (event.target === opsModal) {
      hideOpsModal(false);
    }
  });
  howToModal.addEventListener("click", (event) => {
    if (event.target === howToModal) {
      hideHowToModal();
    }
  });
  importGithubButton.addEventListener("click", async () => {
    try {
      await importFromGithub();
    } catch (error) {
      console.error(error);
      log("GitHub import failed: " + (error.message || String(error)), "error");
    }
  });
  checkGithubUpdateButton.addEventListener("click", async () => {
    try {
      await checkAllGithubUpdates();
    } catch (error) {
      console.error(error);
      log("GitHub update check failed: " + (error.message || String(error)), "error");
    }
  });
  exportAllGamesButton.addEventListener("click", async () => {
    try {
      await downloadAllGamesBundle();
    } catch (error) {
      console.error(error);
      log("Bundle export failed: " + (error.message || String(error)), "error");
    }
  });
  importBundleButton.addEventListener("click", pickBundleFile);
  exportSaveDataButton.addEventListener("click", exportSaveData);
  importSaveDataButton.addEventListener("click", () => {
    saveImportInput.value = "";
    saveImportInput.click();
  });
  if (networkLoadManifestButton) {
    networkLoadManifestButton.addEventListener("click", async () => {
      try {
        await loadNetworkTransferManifest();
      } catch (error) {
        console.error(error);
        setNetworkTransferStatus("Could not load host manifest.", "error");
      }
    });
  }
  if (networkImportSelectedButton) {
    networkImportSelectedButton.addEventListener("click", async () => {
      try {
        await importSelectedNetworkTransfers();
      } catch (error) {
        console.error(error);
        setNetworkTransferStatus("Network import failed: " + (error.message || String(error)), "error");
      }
    });
  }
  if (networkUploadToHostButton) {
    networkUploadToHostButton.addEventListener("click", async () => {
      try {
        await uploadNetworkBundleWithOtc();
      } catch (error) {
        console.error(error);
        setNetworkTransferStatus("Host upload failed: " + (error.message || String(error)), "error");
      }
    });
  }
  if (networkTransferList) {
    networkTransferList.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
        return;
      }
      const itemId = String(target.getAttribute("data-network-item-id") || "");
      if (!itemId) {
        return;
      }
      const item = state.networkTransfer.items.find((entry) => entry && entry.id === itemId);
      if (!item) {
        return;
      }
      item.selected = target.checked;
      syncNetworkImportButtonState();
    });
  }
  if (networkHostUrlInput) {
    networkHostUrlInput.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      await loadNetworkTransferManifest();
    });
  }
  exportErrorLogsButton.addEventListener("click", async () => {
    try {
      await downloadErrorLogs();
    } catch (error) {
      console.error(error);
      log("Error log export failed: " + (error.message || String(error)), "error");
    }
  });
  launchButton.addEventListener("click", launchSelectedGame);
  deleteGameButton.addEventListener("click", deleteSelectedGame);
  gameSearch.addEventListener("input", () => {
    state.searchQuery = gameSearch.value || "";
    renderGameCards();
  });

  gamesGrid.addEventListener("click", async (event) => {
    if (Date.now() < state.suppressCardClickUntil) {
      event.preventDefault();
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.dataset.action || "";
    const gameId = target.dataset.gameId || target.closest("[data-game-id]")?.dataset.gameId || "";
    if (!gameId || !state.gamesById.has(gameId)) {
      return;
    }

    if (action === "edit-game") {
      await selectGameById(gameId);
      openGameEditModal(gameId);
      return;
    }
    if (action === "launch") {
      await selectGameById(gameId);
      await launchSelectedGame();
      return;
    }
    if (action === "delete") {
      await selectGameById(gameId);
      await deleteSelectedGame();
      return;
    }
    await selectGameById(gameId);
  });

  gamesGrid.addEventListener("dblclick", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const gameId = target.closest("[data-game-id]")?.dataset.gameId || "";
    if (!gameId || !state.gamesById.has(gameId)) {
      return;
    }
    await selectGameById(gameId);
    await launchSelectedGame();
  });

  gamesGrid.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (state.searchQuery.trim()) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.closest(".game-buttons") || target.closest(".game-edit-trigger")) {
      return;
    }
    const card = target.closest(".game-item");
    const gameId = card && card.dataset ? card.dataset.gameId || "" : "";
    if (!card || !gameId || !state.gamesById.has(gameId)) {
      return;
    }
    setSelectedGameImmediate(gameId, { persist: true, updateCardStyles: true });

    cleanupReorderHoldTimer();
    state.reorder.pointerId = event.pointerId;
    state.reorder.startTarget = card;
    state.reorder.holdStartX = event.clientX;
    state.reorder.holdStartY = event.clientY;
    state.reorder.pointerX = event.clientX;
    state.reorder.pointerY = event.clientY;
    state.reorder.holdMoveListener = (moveEvent) => {
      if (state.reorder.active) {
        return;
      }
      if (moveEvent.pointerId !== state.reorder.pointerId) {
        return;
      }
      state.reorder.pointerX = moveEvent.clientX;
      state.reorder.pointerY = moveEvent.clientY;
      const dx = moveEvent.clientX - state.reorder.holdStartX;
      const dy = moveEvent.clientY - state.reorder.holdStartY;
      if (Math.hypot(dx, dy) > 8) {
        cleanupReorderHoldTimer();
      }
    };
    window.addEventListener("pointermove", state.reorder.holdMoveListener, true);
    state.reorder.holdTimer = window.setTimeout(() => {
      state.reorder.holdTimer = 0;
      startCardReorder(gameId, card, {
        clientX: state.reorder.pointerX,
        clientY: state.reorder.pointerY
      });
    }, 300);
  });

  window.addEventListener("pointerup", () => {
    if (!state.reorder.active) {
      cleanupReorderHoldTimer();
      state.reorder.pointerId = null;
      state.reorder.startTarget = null;
    }
  }, true);

  window.addEventListener("pointercancel", () => {
    if (!state.reorder.active) {
      cleanupReorderHoldTimer();
      state.reorder.pointerId = null;
      state.reorder.startTarget = null;
    }
  }, true);

  closeGameEditModalButton.addEventListener("click", closeGameEditModal);
  gameEditModal.addEventListener("click", (event) => {
    if (event.target === gameEditModal) {
      closeGameEditModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && saveImportModal.classList.contains("open")) {
      closeSaveImportModal();
      return;
    }
    if (event.key === "Escape" && bundlePreviewModal.classList.contains("open")) {
      const resolver = closeBundlePreviewModal();
      if (resolver) {
        resolver(null);
      }
      return;
    }
    if (event.key === "Escape" && genericChoiceModal.classList.contains("open")) {
      const resolver = closeGenericChoiceModal();
      if (resolver) {
        resolver("cancel");
      }
    }
    if (event.key === "Escape" && githubImportModal.classList.contains("open")) {
      const resolver = closeGithubImportModal();
      if (resolver) {
        resolver("");
      }
      return;
    }
    if (event.key === "Escape" && replaceTargetModal.classList.contains("open")) {
      closeReplaceTargetModal();
      return;
    }
    if (event.key === "Escape" && updatePromptModal.classList.contains("open")) {
      const resolver = closeUpdatePromptModal();
      if (resolver) {
        resolver("skip");
      }
      return;
    }
    if (event.key === "Escape" && extractorMigrationModal.classList.contains("open")) {
      const resolver = closeExtractorMigrationModal();
      if (resolver) {
        resolver({ action: "cancel", dontAsk: false });
      }
      return;
    }
    if (event.key === "Escape" && opsModal.classList.contains("open")) {
      hideOpsModal(false);
      return;
    }
    if (event.key === "Escape" && howToModal.classList.contains("open")) {
      hideHowToModal();
      return;
    }
    if (event.key === "Escape" && gameEditModal.classList.contains("open")) {
      closeGameEditModal();
    }
  });
  uploadGameEditImageButton.addEventListener("click", () => {
    gameEditImageInput.value = "";
    gameEditImageInput.click();
  });
  gameEditNameInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    await saveGameEditChanges();
  });
  gameEditNameInput.addEventListener("input", () => {
    const value = gameEditNameInput.value.trim();
    gameEditPreviewTitle.textContent = value || "Untitled game";
  });
  gameEditImageInput.addEventListener("change", () => {
    if (!gameEditImageInput.files || !gameEditImageInput.files.length) {
      return;
    }
    loadGameEditImageSource(gameEditImageInput.files[0]);
  });
  saveGameEditChangesButton.addEventListener("click", async () => {
    try {
      await saveGameEditChanges();
    } catch (error) {
      console.error(error);
      log("Could not save changes.", "error");
    }
  });
  exportSelectedGameButton.addEventListener("click", async () => {
    try {
      const gameId = state.selectedGameId;
      const game = gameId ? state.gamesById.get(gameId) : null;
      if (!game) {
        log("Select a game in the library first to export.", "error");
        return;
      }
      const choice = await askExportDecision(game);
      if (choice === "optionA") {
        await downloadGameStandard(game);
      } else if (choice === "optionB") {
        await downloadGameWithTransformationsReverted(game);
      }
    } catch (error) {
      console.error(error);
      log("Could not export game.", "error");
    }
  });
  removeGameEditImageButton.addEventListener("click", async () => {
    try {
      await removeGameEditImage();
    } catch (error) {
      console.error(error);
      log("Could not remove game image.", "error");
    }
  });

  genericChoiceOptionBButton.addEventListener("click", () => {
    const resolver = closeGenericChoiceModal();
    if (resolver) {
      resolver("optionB");
    }
  });
  genericChoiceOptionAButton.addEventListener("click", () => {
    const resolver = closeGenericChoiceModal();
    if (resolver) {
      resolver("optionA");
    }
  });
  genericChoiceCancelButton.addEventListener("click", () => {
    const resolver = closeGenericChoiceModal();
    if (resolver) {
      resolver("cancel");
    }
  });
  githubImportSubmitButton.addEventListener("click", () => {
    const resolver = closeGithubImportModal();
    if (resolver) {
      resolver(String(githubImportInput.value || "").trim());
    }
  });
  githubImportCancelButton.addEventListener("click", () => {
    const resolver = closeGithubImportModal();
    if (resolver) {
      resolver("");
    }
  });
  replaceTargetChooseButton.addEventListener("click", () => {
    const selectedId = String(state.replaceTargetSelectedId || "");
    closeReplaceTargetModal();
    if (!selectedId) {
      log("Choose a game to replace first.", "error");
      return;
    }
    pickReplaceZipForGameId(selectedId).catch((error) => {
      console.error(error);
      log("Replace import failed: " + (error.message || String(error)), "error");
    });
  });
  replaceTargetCancelButton.addEventListener("click", () => {
    closeReplaceTargetModal();
    log("Replace import canceled.");
  });
  replaceTargetList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const card = target.closest(".replace-target-card");
    if (!card || !card.dataset || !card.dataset.gameId) {
      return;
    }
    state.replaceTargetSelectedId = String(card.dataset.gameId);
    renderReplaceTargetList();
  });
  githubImportInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const resolver = closeGithubImportModal();
    if (resolver) {
      resolver(String(githubImportInput.value || "").trim());
    }
  });
  updatePromptInstallButton.addEventListener("click", () => {
    const resolver = closeUpdatePromptModal();
    if (resolver) {
      resolver("update");
    }
  });
  updatePromptSkipButton.addEventListener("click", () => {
    const resolver = closeUpdatePromptModal();
    if (resolver) {
      resolver("skip");
    }
  });
  updatePromptStopButton.addEventListener("click", () => {
    const resolver = closeUpdatePromptModal();
    if (resolver) {
      resolver("stop");
    }
  });
  extractorMigrationUpdateButton.addEventListener("click", () => {
    const dontAsk = Boolean(extractorMigrationDontAsk && extractorMigrationDontAsk.checked);
    const resolver = closeExtractorMigrationModal();
    if (resolver) {
      resolver({ action: "update", dontAsk });
    }
  });
  extractorMigrationSkipButton.addEventListener("click", () => {
    const resolver = closeExtractorMigrationModal();
    if (resolver) {
      resolver({ action: "skip", dontAsk: false });
    }
  });
  extractorMigrationCancelButton.addEventListener("click", () => {
    const resolver = closeExtractorMigrationModal();
    if (resolver) {
      resolver({ action: "cancel", dontAsk: false });
    }
  });
  genericChoiceModal.addEventListener("click", (event) => {
    if (event.target === genericChoiceModal) {
      const resolver = closeGenericChoiceModal();
      if (resolver) {
        resolver("cancel");
      }
    }
  });
  githubImportModal.addEventListener("click", (event) => {
    if (event.target === githubImportModal) {
      const resolver = closeGithubImportModal();
      if (resolver) {
        resolver("");
      }
    }
  });
  replaceTargetModal.addEventListener("click", (event) => {
    if (event.target === replaceTargetModal) {
      closeReplaceTargetModal();
    }
  });
  updatePromptModal.addEventListener("click", (event) => {
    if (event.target === updatePromptModal) {
      const resolver = closeUpdatePromptModal();
      if (resolver) {
        resolver("skip");
      }
    }
  });
  extractorMigrationModal.addEventListener("click", (event) => {
    if (event.target === extractorMigrationModal) {
      const resolver = closeExtractorMigrationModal();
      if (resolver) {
        resolver({ action: "cancel", dontAsk: false });
      }
    }
  });
  bundlePreviewSelectAllButton.addEventListener("click", () => {
    if (!state.bundlePreviewDraft || !Array.isArray(state.bundlePreviewDraft.games)) {
      return;
    }
    const draft = state.bundlePreviewDraft;
    const globalMode = String(draft.globalConflictMode || "replace");
    for (const game of state.bundlePreviewDraft.games) {
      if (!game.isInvalid) {
        game.selected = true;
        if (!draft.individualConflictControl && game.hasConflict) {
          game.mode = globalMode;
        } else if (game.mode === "skip") {
          game.mode = game.canReplace ? "replace" : "import";
        }
      }
    }
    renderBundlePreviewModal();
  });
  bundlePreviewSelectNoneButton.addEventListener("click", () => {
    if (!state.bundlePreviewDraft || !Array.isArray(state.bundlePreviewDraft.games)) {
      return;
    }
    for (const game of state.bundlePreviewDraft.games) {
      game.selected = false;
      game.mode = "skip";
    }
    renderBundlePreviewModal();
  });
  bundlePreviewConflictModeButton.addEventListener("click", () => {
    const draft = state.bundlePreviewDraft;
    if (!draft || !Array.isArray(draft.games)) {
      return;
    }
    draft.globalConflictMode = cycleGlobalConflictMode(draft.globalConflictMode);
    if (!draft.individualConflictControl) {
      for (const game of draft.games) {
        if (!game || !game.hasConflict || game.isInvalid) {
          continue;
        }
        if (!game.selected) {
          continue;
        }
        game.mode = draft.globalConflictMode;
      }
    }
    renderBundlePreviewModal();
  });
  bundlePreviewIndividualModeButton.addEventListener("click", () => {
    const draft = state.bundlePreviewDraft;
    if (!draft || !Array.isArray(draft.games)) {
      return;
    }
    draft.individualConflictControl = !draft.individualConflictControl;
    if (!draft.individualConflictControl) {
      for (const game of draft.games) {
        if (!game || !game.hasConflict || game.isInvalid) {
          continue;
        }
        if (!game.selected) {
          continue;
        }
        game.mode = draft.globalConflictMode;
      }
    }
    renderBundlePreviewModal();
  });
  bundlePreviewList.addEventListener("change", (event) => {
    if (!state.bundlePreviewDraft || !Array.isArray(state.bundlePreviewDraft.games)) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.dataset.action || "";
    const index = Number(target.dataset.index);
    if (!Number.isFinite(index)) {
      return;
    }
    const game = state.bundlePreviewDraft.games.find((entry) => entry.index === index);
    if (!game) {
      return;
    }
    if (action === "toggle-select" && target instanceof HTMLInputElement) {
      game.selected = target.checked;
      if (!target.checked) {
        game.mode = "skip";
      } else if (!state.bundlePreviewDraft.individualConflictControl && game.hasConflict) {
        game.mode = state.bundlePreviewDraft.globalConflictMode || "replace";
      } else if (game.mode === "skip") {
        game.mode = game.canReplace ? "replace" : "import";
      }
      renderBundlePreviewModal();
      return;
    }
    if (action === "change-mode" && target instanceof HTMLSelectElement) {
      game.mode = target.value || "skip";
      if (game.mode === "skip") {
        game.selected = false;
      } else {
        game.selected = true;
      }
      renderBundlePreviewModal();
    }
  });
  bundlePreviewCancelButton.addEventListener("click", () => {
    const resolver = closeBundlePreviewModal();
    if (resolver) {
      resolver(null);
    }
  });
  bundlePreviewImportButton.addEventListener("click", () => {
    const draft = state.bundlePreviewDraft;
    const resolver = closeBundlePreviewModal();
    if (!resolver) {
      return;
    }
    if (!draft || !Array.isArray(draft.games)) {
      resolver(null);
      return;
    }
    resolver({
      games: draft.games.map((game) => ({
        index: game.index,
        selected: Boolean(game.selected) && !game.isInvalid && game.mode !== "skip",
        mode: String(game.mode || "skip")
      }))
    });
  });
  bundlePreviewModal.addEventListener("click", (event) => {
    if (event.target === bundlePreviewModal) {
      const resolver = closeBundlePreviewModal();
      if (resolver) {
        resolver(null);
      }
    }
  });

  zipInput.addEventListener("change", async () => {
    if (!zipInput.files || !zipInput.files.length) {
      return;
    }
    await importZipFile(zipInput.files[0]);
  });
  replaceZipInput.addEventListener("change", async () => {
    if (!replaceZipInput.files || !replaceZipInput.files.length) {
      return;
    }
    const replaceGameId = String(replaceZipInput.dataset.replaceGameId || "");
    await importZipFile(replaceZipInput.files[0], {
      importMode: "replace",
      replaceGameId
    });
  });
  bundleInput.addEventListener("change", async () => {
    if (!bundleInput.files || !bundleInput.files.length) {
      return;
    }
    await importBundleFile(bundleInput.files[0]);
  });

  saveImportInput.addEventListener("change", async () => {
    if (!saveImportInput.files || !saveImportInput.files.length) return;
    await handleSaveImportFile(saveImportInput.files[0]);
    saveImportInput.value = "";
  });

  saveImportList.addEventListener("change", (event) => {
    const select = event.target.closest("select[data-save-import-type]");
    if (!select || !state.saveImportDraft) return;
    const type = select.dataset.saveImportType;
    const draft = state.saveImportDraft;
    if (type === "localstorage") {
      draft.localStorageAction = select.value;
    } else if (type === "unity") {
      const index = parseInt(select.dataset.saveImportIndex, 10);
      if (!isNaN(index) && draft.unityRows[index]) draft.unityRows[index].action = select.value;
    } else if (type === "db") {
      const index = parseInt(select.dataset.saveImportIndex, 10);
      if (!isNaN(index) && draft.otherDbRows[index]) draft.otherDbRows[index].action = select.value;
    }
    renderSaveImportList();
  });

  wrongZipTypeOkButton.addEventListener("click", closeWrongZipTypeModal);

  const autoImportCloseBtn = document.getElementById("autoImportCloseBtn");
  const autoImportModal = document.getElementById("autoImportModal");
  if (autoImportCloseBtn && autoImportModal) {
    autoImportCloseBtn.addEventListener("click", () => {
      autoImportModal.classList.remove("open");
      autoImportModal.setAttribute("aria-hidden", "true");
    });
  }

  saveImportCancelButton.addEventListener("click", closeSaveImportModal);

  saveImportConfirmButton.addEventListener("click", async () => {
    const draft = state.saveImportDraft;
    if (!draft) return;
    const plan = {
      localStorageAction: draft.localStorageAction,
      localStorageData: draft.localStorageData,
      unityGames: (draft.unityRows || []).map((row) => ({
        sourceHash: row.sourceHash,
        action: row.action,
        records: row.records
      })),
      otherDbs: (draft.otherDbRows || []).map((row) => ({
        dbName: row.dbName,
        stores: row.stores,
        action: row.action
      }))
    };
    closeSaveImportModal();
    setActionButtonsDisabled(true);
    try {
      await applySaveImport(plan);
      const parts = [];
      if (plan.localStorageAction === "import") parts.push("localStorage");
      const unityCount = plan.unityGames.filter((g) => g.action !== "ignore").length;
      if (unityCount) parts.push(unityCount + " Unity game(s)");
      const dbCount = plan.otherDbs.filter((d) => d.action !== "ignore").length;
      if (dbCount) parts.push(dbCount + " other DB(s)");
      log("Imported: " + (parts.length ? parts.join(", ") : "nothing") + ".");
    } catch (err) {
      console.error(err);
      log("Save import failed: " + (err.message || String(err)), "error");
    } finally {
      setActionButtonsDisabled(false);
    }
  });

  saveImportModal.addEventListener("click", (event) => {
    if (event.target === saveImportModal) closeSaveImportModal();
  });

  window.addEventListener("dragenter", (event) => {
    if (!hasDragFiles(event)) {
      return;
    }
    event.preventDefault();
    state.dragDepth += 1;
    setDragDropOverlay(true, "Drop ZIP files to import");
  });

  window.addEventListener("dragover", (event) => {
    if (!hasDragFiles(event)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    setDragDropOverlay(true, "Drop ZIP files to import");
  });

  window.addEventListener("dragleave", (event) => {
    if (!hasDragFiles(event)) {
      return;
    }
    event.preventDefault();
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) {
      setDragDropOverlay(false);
    }
  });

  window.addEventListener("drop", async (event) => {
    if (!hasDragFiles(event)) {
      return;
    }
    event.preventDefault();
    state.dragDepth = 0;
    setDragDropOverlay(false);
    await handleDroppedZipFiles(event.dataTransfer && event.dataTransfer.files
      ? event.dataTransfer.files
      : []);
  });

  // Listen for runtime errors posted from launched games and persist them for export.
  window.addEventListener("message", (event) => {
    const payload = event && event.data;
    if (!payload || typeof payload !== "object" || payload.__cbgamesPlayerLog !== true) {
      return;
    }
    if (state.playerWindow && event.source && event.source !== state.playerWindow) {
      return;
    }
    persistPlayerError(payload).catch((error) => {
      console.error(error);
      log("Could not save game error log.", "error");
    });
  });

  if (networkHostUrlInput && !networkHostUrlInput.value) {
    networkHostUrlInput.value = state.networkTransfer.hostUrl || NETWORK_TRANSFER_DEFAULT_HOST_URL;
  }
  setNetworkTransferStatus("Enter a host URL, then click Load Shared.");
  renderNetworkTransferList();

  setEmptyEntryState("Loading...");
// --- helpers ---
function showOpsModal() {
    if (!opsModal) {
      return;
    }
    opsModal.classList.add("open");
    opsModal.setAttribute("aria-hidden", "false");
    if (!state.actionInProgress && importZipButton) {
      importZipButton.focus();
    }
  }
function hideOpsModal(force) {
    if (!opsModal) {
      return false;
    }
    if (state.actionInProgress && !force) {
      return false;
    }
    opsModal.classList.remove("open");
    opsModal.setAttribute("aria-hidden", "true");
    if (openOpsModalButton && !openOpsModalButton.disabled) {
      openOpsModalButton.focus();
    }
    return true;
  }
function showHowToModal() {
    if (!howToModal) {
      return;
    }
    howToModal.classList.add("open");
    howToModal.setAttribute("aria-hidden", "false");
    if (closeHowToModalButton && !closeHowToModalButton.disabled) {
      closeHowToModalButton.focus();
    }
  }
function hideHowToModal() {
    if (!howToModal) {
      return;
    }
    howToModal.classList.remove("open");
    howToModal.setAttribute("aria-hidden", "true");
    if (openHowToModalButton && !openHowToModalButton.disabled) {
      openHowToModalButton.focus();
    }
  }
function getGridReorderElements() {
    return Array.from(gamesGrid.querySelectorAll(".game-item[data-game-id]"));
  }
function cleanupReorderHoldTimer() {
    if (state.reorder.holdTimer) {
      clearTimeout(state.reorder.holdTimer);
      state.reorder.holdTimer = 0;
    }
    if (state.reorder.holdMoveListener) {
      window.removeEventListener("pointermove", state.reorder.holdMoveListener, true);
      state.reorder.holdMoveListener = null;
    }
  }
function applyGridShiftAnimation(beforeRects) {
    const elements = getGridReorderElements().concat(
      state.reorder.placeholder ? [state.reorder.placeholder] : []
    );
    for (const el of elements) {
      const key = el.dataset.gameId ? "game:" + el.dataset.gameId : "gap";
      const prev = beforeRects.get(key);
      if (!prev) {
        continue;
      }
      const next = el.getBoundingClientRect();
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        continue;
      }
      const existingAnimation = reorderAnimations.get(el);
      if (existingAnimation) {
        try {
          existingAnimation.cancel();
        } catch {
          // ignore cancel issues
        }
      }
      if (typeof el.animate !== "function") {
        continue;
      }
      const animation = el.animate(
        [
          { transform: "translate(" + dx + "px," + dy + "px)" },
          { transform: "translate(0px,0px)" }
        ],
        {
          duration: 180,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          fill: "none"
        }
      );
      reorderAnimations.set(el, animation);
    }
  }
function moveReorderPlaceholderBefore(targetNode) {
    const placeholder = state.reorder.placeholder;
    if (!placeholder || !targetNode || placeholder === targetNode || placeholder.nextSibling === targetNode) {
      return;
    }
    const beforeRects = new Map();
    for (const el of getGridReorderElements()) {
      beforeRects.set("game:" + el.dataset.gameId, el.getBoundingClientRect());
    }
    beforeRects.set("gap", placeholder.getBoundingClientRect());
    gamesGrid.insertBefore(placeholder, targetNode);
    applyGridShiftAnimation(beforeRects);
  }
function moveReorderPlaceholderToEnd() {
    const placeholder = state.reorder.placeholder;
    if (!placeholder || gamesGrid.lastElementChild === placeholder) {
      return;
    }
    const beforeRects = new Map();
    for (const el of getGridReorderElements()) {
      beforeRects.set("game:" + el.dataset.gameId, el.getBoundingClientRect());
    }
    beforeRects.set("gap", placeholder.getBoundingClientRect());
    gamesGrid.append(placeholder);
    applyGridShiftAnimation(beforeRects);
  }
function updateReorderGhostPosition(clientX, clientY) {
    const ghost = state.reorder.ghost;
    if (!ghost) {
      return;
    }
    ghost.style.left = Math.round(clientX - state.reorder.pointerOffsetX) + "px";
    ghost.style.top = Math.round(clientY - state.reorder.pointerOffsetY) + "px";
  }
function reorderPointerMove(event) {
    if (!state.reorder.active) {
      return;
    }
    if (event.pointerId !== state.reorder.pointerId) {
      return;
    }
    event.preventDefault();
    updateReorderGhostPosition(event.clientX, event.clientY);
    const hovered = document.elementFromPoint(event.clientX, event.clientY);
    const item = hovered instanceof Element ? hovered.closest(".game-item") : null;
    if (!item || !item.dataset || !item.dataset.gameId || item === state.reorder.sourceElement) {
      return;
    }
    const rect = item.getBoundingClientRect();
    const insertAfter = event.clientX > rect.left + rect.width / 2;
    if (insertAfter) {
      if (!item.nextSibling) {
        moveReorderPlaceholderToEnd();
        return;
      }
      moveReorderPlaceholderBefore(item.nextSibling);
    } else {
      moveReorderPlaceholderBefore(item);
    }
  }
async function persistGridOrderFromDom() {
    const ids = getGridReorderElements()
      .map((el) => String(el.dataset.gameId || ""))
      .filter((id) => id && state.gamesById.has(id));
    let changed = false;
    for (let i = 0; i < ids.length; i += 1) {
      const game = state.gamesById.get(ids[i]);
      if (!game) {
        continue;
      }
      if (Number(game.sortOrder) !== i) {
        game.sortOrder = i;
        state.gamesById.set(game.id, game);
        changed = true;
      }
    }
    if (!changed) {
      return;
    }
    for (const game of sortedGames()) {
      await putGame(game);
    }
  }
async function finishCardReorder() {
    if (!state.reorder.active) {
      return;
    }
    const { sourceElement, placeholder, ghost } = state.reorder;
    try {
      if (sourceElement && placeholder && placeholder.parentElement === gamesGrid) {
        gamesGrid.insertBefore(sourceElement, placeholder);
      }
      if (placeholder && placeholder.parentElement) {
        placeholder.remove();
      }
      if (ghost && ghost.parentElement) {
        ghost.remove();
      }
      if (sourceElement) {
        sourceElement.classList.remove("is-drag-source");
      }
      await persistGridOrderFromDom();
      renderGameOptions(state.selectedGameId);
      updateSelectedGameInfo(state.selectedGameId ? state.gamesById.get(state.selectedGameId) : null);
      state.suppressCardClickUntil = Date.now() + 250;
    } finally {
      state.reorder.active = false;
      state.reorder.pointerId = null;
      state.reorder.sourceGameId = "";
      state.reorder.sourceElement = null;
      state.reorder.placeholder = null;
      state.reorder.ghost = null;
      state.reorder.pointerOffsetX = 0;
      state.reorder.pointerOffsetY = 0;
      window.removeEventListener("pointermove", reorderPointerMove);
      window.removeEventListener("pointerup", reorderPointerUp, true);
      window.removeEventListener("pointercancel", reorderPointerUp, true);
    }
  }
function reorderPointerUp(event) {
    if (state.reorder.active && event.pointerId === state.reorder.pointerId) {
      event.preventDefault();
      finishCardReorder().catch((error) => {
        console.error(error);
        log("Could not save card order.", "error");
      });
    }
    cleanupReorderHoldTimer();
    state.reorder.pointerId = null;
    state.reorder.startTarget = null;
  }
function startCardReorder(gameId, sourceElement, pointerEvent) {
    if (!sourceElement || !gameId || !state.gamesById.has(gameId)) {
      return;
    }
    setSelectedGameImmediate(gameId, { persist: true, updateCardStyles: false });
    state.reorder.active = true;
    cleanupReorderHoldTimer();
    state.reorder.sourceGameId = gameId;
    state.reorder.sourceElement = sourceElement;

    const rect = sourceElement.getBoundingClientRect();
    const placeholder = document.createElement("div");
    placeholder.className = "drag-gap";
    placeholder.style.height = Math.max(88, rect.height) + "px";
    placeholder.style.minHeight = Math.max(88, rect.height) + "px";
    state.reorder.placeholder = placeholder;

    const ghost = sourceElement.cloneNode(true);
    ghost.classList.add("reorder-ghost");
    ghost.style.width = Math.round(rect.width) + "px";
    ghost.style.left = Math.round(rect.left) + "px";
    ghost.style.top = Math.round(rect.top) + "px";
    state.reorder.ghost = ghost;

    state.reorder.pointerOffsetX = rect.width / 2;
    state.reorder.pointerOffsetY = rect.height / 2;

    sourceElement.classList.add("is-drag-source");
    gamesGrid.insertBefore(placeholder, sourceElement);
    sourceElement.remove();
    document.body.append(ghost);
    updateReorderGhostPosition(pointerEvent.clientX, pointerEvent.clientY);

    window.addEventListener("pointermove", reorderPointerMove, { passive: false });
    window.addEventListener("pointerup", reorderPointerUp, true);
    window.addEventListener("pointercancel", reorderPointerUp, true);
  }
function setDragDropOverlay(visible, label) {
    if (!dragDropOverlay) {
      return;
    }
    dragDropOverlay.classList.toggle("open", Boolean(visible));
    dragDropOverlay.setAttribute("aria-hidden", visible ? "false" : "true");
    if (dragDropOverlayText && typeof label === "string" && label.trim()) {
      dragDropOverlayText.textContent = label;
    } else if (dragDropOverlayText) {
      dragDropOverlayText.textContent = "Drop ZIP files to import";
    }
  }
