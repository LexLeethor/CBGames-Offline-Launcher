"use strict";
function setSelectedGameImmediate(gameId, options = {}) {
    const persist = options.persist !== false;
    const updateCardStyles = options.updateCardStyles !== false;
    if (!gameId || !state.gamesById.has(gameId)) {
      return;
    }
    if (state.selectedGameId === gameId) {
      return;
    }
    state.selectedGameId = gameId;
    gameSelect.value = gameId;
    updateSelectedGameInfo(state.gamesById.get(gameId) || null);
    if (updateCardStyles) {
      for (const el of getGridReorderElements()) {
        const id = String(el.dataset.gameId || "");
        el.classList.toggle("is-selected", id === gameId);
      }
    }
    if (persist) {
      putSetting(SETTING_SELECTED_GAME, gameId).catch((error) => {
        console.error(error);
        log("Could not persist selected game.", "error");
      });
    }
  }

async function selectGameById(nextId) {
    const selectedId = nextId && state.gamesById.has(nextId) ? nextId : null;
    state.selectedGameId = selectedId;
    gameSelect.value = selectedId || "";
    await putSetting(SETTING_SELECTED_GAME, selectedId || "");
    updateSelectedGameInfo(selectedId ? state.gamesById.get(selectedId) : null);
    renderGameCards();
  }

function setActionButtonsDisabled(disabled) {
    const value = Boolean(disabled);
    state.actionInProgress = value;
    importZipButton.disabled = value;
    replaceZipSelectedButton.disabled = value;
    openOpsModalButton.disabled = value;
    launchButton.disabled = value;
    deleteGameButton.disabled = value;
    exportAllGamesButton.disabled = value;
    importBundleButton.disabled = value;
    importGithubButton.disabled = value;
    checkGithubUpdateButton.disabled = value;
    exportErrorLogsButton.disabled = value;
    closeOpsModalButton.disabled = value;
    if (networkHostUrlInput) {
      networkHostUrlInput.disabled = value;
    }
    if (networkLoadManifestButton) {
      networkLoadManifestButton.disabled = value;
    }
    if (networkUploadCodeInput) {
      networkUploadCodeInput.disabled = value;
    }
    if (networkUploadToHostButton) {
      networkUploadToHostButton.disabled = value;
    }
    if (networkTransferList) {
      const checkboxes = networkTransferList.querySelectorAll("input[type=\"checkbox\"][data-network-item-id]");
      for (const checkbox of checkboxes) {
        checkbox.disabled = value;
      }
    }
    if (!value) {
      syncNetworkImportButtonState();
    } else if (networkImportSelectedButton) {
      networkImportSelectedButton.disabled = true;
    }
  }

async function loadLibrary(preferredGameId) {
    state.libraryChecked = false;
    const storedGames = await getAllGames();
    const games = storedGames.map((game) => ({
      ...game,
      githubSource: normalizeGithubSource(game.githubSource),
      unityDetected: Boolean(game.unityDetected),
      flashDetected: typeof game.flashDetected === "boolean" ? game.flashDetected : false
    }));

    // One-time backfill for older saves that predate flashDetected.
    for (let i = 0; i < games.length; i += 1) {
      const raw = storedGames[i];
      const normalized = games[i];
      if (typeof raw.flashDetected === "boolean") {
        continue;
      }
      try {
        const hasFlash = await detectFlashFromStoredFiles(normalized.id);
        normalized.flashDetected = hasFlash;
        raw.flashDetected = hasFlash;
        await putGame(raw);
      } catch (error) {
        console.error(error);
        log("Could not detect Flash files for " + (normalized.name || normalized.id) + ".", "error");
      }
    }

    const forceBadgeRescan = shouldRunSecretBadgeRescan() && !state.badgeRescanCompleted;
    if (forceBadgeRescan) {
      log("Secret badge rescan enabled. Re-checking all saved games...");
      for (let i = 0; i < games.length; i += 1) {
        const raw = storedGames[i];
        const normalized = games[i];
        try {
          const [hasUnity, hasFlash] = await Promise.all([
            detectUnityFromStoredFiles(normalized.id),
            detectFlashFromStoredFiles(normalized.id)
          ]);
          const unityChanged = Boolean(raw.unityDetected) !== hasUnity;
          const flashChanged = Boolean(raw.flashDetected) !== hasFlash;
          if (unityChanged || flashChanged) {
            raw.unityDetected = hasUnity;
            raw.flashDetected = hasFlash;
            normalized.unityDetected = hasUnity;
            normalized.flashDetected = hasFlash;
            await putGame(raw);
          }
        } catch (error) {
          console.error(error);
          log("Badge rescan failed for " + (normalized.name || normalized.id) + ".", "error");
        }
      }
      state.badgeRescanCompleted = true;
      log("Badge rescan complete.");
    }

    state.gamesById = new Map(games.map((game) => [game.id, game]));
    try {
      await recoverInterruptedGithubImports();
    } catch (error) {
      console.error(error);
      log("Could not recover unfinished GitHub imports.", "error");
    }
    let nextOrder = 0;
    let changedOrder = false;
    for (const game of sortedGames()) {
      if (Number(game.sortOrder) !== nextOrder) {
        game.sortOrder = nextOrder;
        state.gamesById.set(game.id, game);
        changedOrder = true;
      }
      nextOrder += 1;
    }
    if (changedOrder) {
      for (const game of sortedGames()) {
        await putGame(game);
      }
    }

    state.libraryChecked = true;
    const selectedId = renderGameOptions(preferredGameId || state.selectedGameId);
    state.selectedGameId = selectedId || null;

    if (state.selectedGameId) {
      await putSetting(SETTING_SELECTED_GAME, state.selectedGameId);
    }

    updateSelectedGameInfo(state.selectedGameId ? state.gamesById.get(state.selectedGameId) : null);
    await refreshStorageSummary();
  }
