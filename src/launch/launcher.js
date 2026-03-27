"use strict";
function requestToObjectUrl(rawValue, baseHref) {
    const raw = String(rawValue);
    const resolvedBase = normalizeResolverBase(baseHref);
    const path =
      resolveToPath(raw, resolvedBase) ||
      resolveMediaSchemePath(raw) ||
      resolveFileSchemePath(raw);
    if (!path) {
      return null;
    }

    const directCandidates = buildAssetFallbackCandidates(path);
    for (const candidate of directCandidates) {
      const mapped = state.objectUrls.get(candidate);
      if (mapped) {
        return mapped;
      }
    }

    // Some bundles include an extra top-level folder (e.g. "Turbowarp/...").
    // If direct lookup misses, progressively strip leading segments and retry.
    const pathParts = path.split("/").filter(Boolean);
    if (pathParts.length > 1) {
      for (let i = 1; i < pathParts.length; i += 1) {
        const trimmedPath = pathParts.slice(i).join("/");
        const trimmedCandidates = buildAssetFallbackCandidates(trimmedPath);
        for (const trimmedCandidate of trimmedCandidates) {
          const mapped = state.objectUrls.get(trimmedCandidate);
          if (mapped) {
            return mapped;
          }
        }
      }
    }

    const trimmed = raw.trim();
    const isRootLike =
      trimmed.startsWith("/") ||
      trimmed.startsWith(VFS_ORIGIN) ||
      trimmed.startsWith(VFS_ORIGIN_URL + "/");
    if (!isRootLike) {
      return null;
    }

    let probeDir = "";
    const basePath = resolveToPath(resolvedBase, VFS_ORIGIN);
    if (basePath) {
      probeDir = dirnamePath(basePath);
    } else if (state.activeEntryPath) {
      probeDir = dirnamePath(state.activeEntryPath);
    }

    while (probeDir) {
      const candidate = normalizePath(probeDir + "/" + path);
      const nestedCandidates = buildAssetFallbackCandidates(candidate);
      for (const nestedCandidate of nestedCandidates) {
        const mapped = state.objectUrls.get(nestedCandidate);
        if (mapped) {
          return mapped;
        }
      }
      probeDir = dirnamePath(probeDir);
    }
    return null;
  }

  // Expose the resolver for the player window bridge.
  window.__loaderResolve = requestToObjectUrl;

async function launchSelectedGame() {
    const gameId = state.selectedGameId;
    const game = gameId ? state.gamesById.get(gameId) : null;
    if (!game) {
      log("Choose a saved game first.", "error");
      return;
    }

    const chosenEntry = entrySelect.value || game.entryPath || chooseBestEntryPath(game.htmlEntries || [], "");
    if (!chosenEntry) {
      log("No startup HTML file was found for this game.", "error");
      return;
    }

    launchButton.disabled = true;
    deleteGameButton.disabled = true;

    try {
      setWorkProgress("Loading game data", 0, 4);
      log("Loading \"" + game.name + "\" from IndexedDB...");
      if (!canAccessPlayerWindow(state.playerWindow)) {
        state.playerWindow = openPlayerWindow();
      }
      if (!state.playerWindow) {
        throw new Error("Popup blocked. Allow popups for this file page.");
      }

      const files = await getAllFilesForGame(game.id);
      setWorkProgress("Preparing game assets", 1, 4);
      if (!files.length) {
        throw new Error("No files were found for this game in IndexedDB.");
      }

      await buildObjectUrlCacheFromRecords(files, state.playerWindow);
      await patchDynamicImports();
      setWorkProgress("Preparing game assets", 2, 4);
      state.activeEntryPath = chosenEntry;

      const fileMap = new Map(files.map((record) => [record.path, record]));
      let entryPath = chosenEntry;
      let entryRecord = fileMap.get(entryPath);

      if (!entryRecord) {
        const htmlEntries = files
          .map((record) => record.path)
          .filter((path) => /\.html?$/i.test(path));
        entryPath = chooseBestEntryPath(htmlEntries, game.entryPath || "");
        entryRecord = fileMap.get(entryPath);
      }

      if (!entryRecord) {
        throw new Error("Startup file is missing from saved data.");
      }

      const htmlText = await entryRecord.blob.text();
      const rewrittenHtml = rewriteDocumentHtml(htmlText, entryPath, {
        gameId: game.id,
        gameName: game.name || "",
        entryPath
      });
      setWorkProgress("Opening player window", 3, 4);

      if (!canAccessPlayerWindow(state.playerWindow)) {
        state.playerWindow = openPlayerWindow();
      }
      if (!state.playerWindow) {
        throw new Error("Could not access the player window. Reopen and launch again.");
      }

      state.playerWindow.document.open();
      state.playerWindow.document.write(rewrittenHtml);
      state.playerWindow.document.close();
      state.playerWindow.focus();

      if (game.entryPath !== entryPath) {
        game.entryPath = entryPath;
        state.gamesById.set(game.id, game);
        await putGame(game);
        updateSelectedGameInfo(game);
      }

      setWorkProgress("Launch complete", 4, 4);
      log("Launched: " + game.name + " (" + entryPath + ")");
    } catch (error) {
      console.error(error);
      log("Launch failed: " + (error.message || String(error)), "error");
    } finally {
      launchButton.disabled = false;
      deleteGameButton.disabled = false;
      setTimeout(clearWorkProgress, 350);
    }
  }

async function deleteSelectedGame() {
    const gameId = state.selectedGameId;
    const game = gameId ? state.gamesById.get(gameId) : null;
    if (!game) {
      log("Choose a saved game to delete.", "error");
      return;
    }

    const ok = window.confirm("Delete \"" + game.name + "\" from IndexedDB? This cannot be undone.");
    if (!ok) {
      return;
    }

    setActionButtonsDisabled(true);

    try {
      await deleteFilesByGameId(game.id);
      await deleteGameRecord(game.id);
      state.gamesById.delete(game.id);

      if (state.selectedGameId === game.id) {
        state.selectedGameId = null;
      }

      clearObjectUrls();
      state.activeEntryPath = null;

      if (state.playerWindow && !state.playerWindow.closed) {
        state.playerWindow.close();
      }
      state.playerWindow = null;

      // Recycling the DB connection helps some browsers update storage estimates
      // sooner after large IndexedDB deletions.
      await reopenDatabaseConnection();
      await putSetting(SETTING_SELECTED_GAME, "");
      await loadLibrary();
      log("Deleted game: " + game.name);
    } catch (error) {
      console.error(error);
      log("Delete failed: " + (error.message || String(error)), "error");
    } finally {
      setActionButtonsDisabled(false);
    }
  }

function clearObjectUrls() {
    let host = window;
    try {
      if (
        state.objectUrlHost &&
        state.objectUrlHost.URL &&
        typeof state.objectUrlHost.URL.createObjectURL === "function" &&
        typeof state.objectUrlHost.URL.revokeObjectURL === "function"
      ) {
        host = state.objectUrlHost;
      }
    } catch {
      host = window;
    }
    for (const url of state.objectUrls.values()) {
      try {
        host.URL.revokeObjectURL(url);
      } catch {
        URL.revokeObjectURL(url);
      }
    }
    state.objectUrls.clear();
    state.objectUrlHost = window;
  }

async function persistPlayerError(payload) {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const incomingGameId = typeof payload.gameId === "string" ? payload.gameId : "";
    const resolvedGame = incomingGameId ? state.gamesById.get(incomingGameId) : null;
    const gameId = resolvedGame ? resolvedGame.id : incomingGameId;
    const gameName = resolvedGame
      ? (resolvedGame.name || "")
      : (typeof payload.gameName === "string" ? payload.gameName : "");
    const record = {
      id: makeId(),
      timestamp: Number(payload.timestamp) || Date.now(),
      level: normalizeErrorText(payload.level || "error", 16) || "error",
      kind: normalizeErrorText(payload.kind || "runtime", 80) || "runtime",
      message: normalizeErrorText(payload.message || "Unknown error"),
      source: normalizeErrorText(payload.source || "", 1000),
      lineno: Number(payload.lineno) || 0,
      colno: Number(payload.colno) || 0,
      stack: normalizeErrorText(payload.stack || "", 20000),
      gameId,
      gameName: normalizeErrorText(gameName, 300),
      entryPath: normalizePath(payload.entryPath || "")
    };
    await putErrorLogRecord(record);
    log("[Game Error] " + (record.gameName || record.gameId || "Unknown game") + ": " + record.message, "error");
  }

async function downloadErrorLogs() {
    setActionButtonsDisabled(true);
    try {
      setWorkProgress("Preparing error log export", 0, 0);
      const logs = await getAllErrorLogRecords();
      if (!logs.length) {
        throw new Error("No saved game error logs to export.");
      }
      logs.sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
      const payload = {
        format: "cbgames-error-logs-v1",
        exportedAt: Date.now(),
        totalLogs: logs.length,
        logs
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = "cbgames-error-logs-" + stamp + ".json";
      const url = URL.createObjectURL(blob);
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
      log("Exported " + logs.length + " error log(s) to " + filename + ".");
    } finally {
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }
  }
