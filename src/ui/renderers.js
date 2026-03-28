"use strict";
function renderSaveImportList() {
  const draft = state.saveImportDraft;
  if (!draft) return;
  const games = sortedGames();
  const rows = [];

  // --- localStorage row ---
  if (draft.localStorageData) {
    const action = draft.localStorageAction;
    rows.push(
      "<div class=\"save-import-row\">" +
        "<div class=\"save-import-row-info\">" +
          "<p class=\"save-import-row-slug\">localStorage</p>" +
          "<p class=\"save-import-row-meta\">" + draft.localStorageCount + " key(s)</p>" +
        "</div>" +
        "<div class=\"save-import-row-action\">" +
          "<select data-save-import-type=\"localstorage\">" +
            "<option value=\"import\"" + (action === "import" ? " selected" : "") + ">Import</option>" +
            "<option value=\"ignore\"" + (action === "ignore" ? " selected" : "") + ">Ignore</option>" +
          "</select>" +
        "</div>" +
      "</div>"
    );
  }

  // --- Unity /idbfs game rows ---
  for (let i = 0; i < (draft.unityRows || []).length; i++) {
    const row = draft.unityRows[i];
    const action = row.action;
    let options = "";
    options += "<optgroup label=\"Actions\">";
    options += "<option value=\"ignore\"" + (action === "ignore" ? " selected" : "") + ">Ignore</option>";
    options += "<option value=\"raw\"" + (action === "raw" ? " selected" : "") + ">Import as-is</option>";
    options += "</optgroup>";
    if (row.autoGameId) {
      const g = state.gamesById.get(row.autoGameId);
      const gName = g ? escapeHtml(String(g.name || row.autoGameId)) : escapeHtml(row.autoGameId);
      const val = "auto:" + row.autoGameId;
      options += "<optgroup label=\"Auto-detected\">";
      options += "<option value=\"" + escapeHtml(val) + "\"" + (action === val ? " selected" : "") + ">" + gName + "</option>";
      options += "</optgroup>";
    }
    if (games.length) {
      options += "<optgroup label=\"Map to game\">";
      for (const g of games) {
        const val = "map:" + g.id;
        options += "<option value=\"" + escapeHtml(val) + "\"" + (action === val ? " selected" : "") + ">" + escapeHtml(String(g.name || g.id)) + "</option>";
      }
      options += "</optgroup>";
    }
    rows.push(
      "<div class=\"save-import-row\">" +
        "<div class=\"save-import-row-info\">" +
          "<p class=\"save-import-row-slug\"><span class=\"save-import-badge\">Unity</span> " + escapeHtml(row.zipSlug) + "</p>" +
          "<p class=\"save-import-row-meta\">" + String(row.fileCount || 0) + " file(s)</p>" +
        "</div>" +
        "<div class=\"save-import-row-action\">" +
          "<select data-save-import-type=\"unity\" data-save-import-index=\"" + i + "\">" + options + "</select>" +
        "</div>" +
      "</div>"
    );
  }

  // --- Other IDB rows ---
  for (let i = 0; i < (draft.otherDbRows || []).length; i++) {
    const row = draft.otherDbRows[i];
    const action = row.action;
    const totalRecords = row.stores.reduce((sum, s) => sum + (s.records ? s.records.length : 0), 0);
    rows.push(
      "<div class=\"save-import-row\">" +
        "<div class=\"save-import-row-info\">" +
          "<p class=\"save-import-row-slug\"><span class=\"save-import-badge\">IDB</span> " + escapeHtml(row.dbName) + "</p>" +
          "<p class=\"save-import-row-meta\">" + row.stores.length + " store(s) · " + totalRecords + " record(s)</p>" +
        "</div>" +
        "<div class=\"save-import-row-action\">" +
          "<select data-save-import-type=\"db\" data-save-import-index=\"" + i + "\">" +
            "<option value=\"import\"" + (action === "import" ? " selected" : "") + ">Import</option>" +
            "<option value=\"ignore\"" + (action === "ignore" ? " selected" : "") + ">Ignore</option>" +
          "</select>" +
        "</div>" +
      "</div>"
    );
  }

  saveImportList.innerHTML = rows.join("");
}

function renderReplaceTargetList() {
    const games = sortedGames();
    replaceTargetList.innerHTML = "";
    if (!games.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No games available to replace yet.";
      replaceTargetList.append(empty);
      replaceTargetChooseButton.disabled = true;
      return;
    }
    const selectedId = state.replaceTargetSelectedId && state.gamesById.has(state.replaceTargetSelectedId)
      ? state.replaceTargetSelectedId
      : games[0].id;
    state.replaceTargetSelectedId = selectedId;
    replaceTargetChooseButton.disabled = false;
    for (const game of games) {
      const selectedClass = game.id === selectedId ? " is-selected" : "";
      const hasThumb = typeof game.thumbnailDataUrl === "string" && game.thumbnailDataUrl.length > 0;
      const thumbClass = hasThumb ? "square-button" : "square-button no-thumb";
      const thumbStyle = hasThumb
        ? " style=\"background-image:url('" + escapeHtml(game.thumbnailDataUrl) + "');\""
        : "";
      const badgeItems = buildGameBadgeItemsMarkup(game, false);
      const badges = badgeItems
        ? "<span class=\"game-badges\" aria-hidden=\"true\">" + badgeItems + "</span>"
        : "";
      const card = document.createElement("div");
      card.className = "game-item replace-target-card" + selectedClass;
      card.dataset.gameId = game.id;
      card.innerHTML =
        "<button class=\"" + thumbClass + "\" type=\"button\"" + thumbStyle + " data-action=\"choose-replace\" data-game-id=\"" + escapeHtml(game.id) + "\">" +
          badges +
        "</button>" +
        "<div class=\"game-info\">" +
          "<p class=\"game-title\">" + escapeHtml(game.name || "Untitled game") + "</p>" +
        "</div>";
      replaceTargetList.append(card);
    }
  }

function renderBundlePreviewModal() {
    const draft = state.bundlePreviewDraft;
    if (!draft || !Array.isArray(draft.games)) {
      return;
    }
    const individualMode = Boolean(draft.individualConflictControl);
    const globalConflictMode = String(draft.globalConflictMode || "replace");
    bundlePreviewConflictModeButton.textContent = "Conflicts: " + globalConflictModeLabel(globalConflictMode);
    bundlePreviewIndividualModeButton.textContent = "Per-Game Actions: " + (individualMode ? "On" : "Off");

    bundlePreviewSummary.textContent =
      String(draft.fileName || "bundle.zip") +
      " contains " + draft.games.length +
      " game(s), " + draft.totalFiles + " file(s), " + formatBytes(draft.totalBytes) + ".";

    const rows = [];
    for (const game of draft.games) {
      const statusClass = game.isInvalid ? "bundle-preview-status error" : "bundle-preview-status";
      const rowClass = game.isInvalid ? "bundle-preview-row is-invalid" : "bundle-preview-row";
      const conflictText = game.conflictName
        ? ("Conflicts with \"" + game.conflictName + "\".")
        : "No conflicts detected.";
      const statusText = game.isInvalid
        ? ("Missing payload files: " + game.missingPayloadCount + ".")
        : conflictText;
      const thumbClass = game.thumbnailDataUrl ? "bundle-preview-thumb" : "bundle-preview-thumb no-thumb";
      const thumbStyle = game.thumbnailDataUrl
        ? " style=\"background-image:url('" + escapeHtml(game.thumbnailDataUrl) + "');\""
        : "";
      const modeControl = individualMode
        ? (
            "<select data-action=\"change-mode\" data-index=\"" + game.index + "\"" + (game.isInvalid ? " disabled" : "") + ">" +
              "<option value=\"import\"" + (game.mode === "import" ? " selected" : "") + ">Import</option>" +
              "<option value=\"replace\"" + (game.mode === "replace" ? " selected" : "") + (game.canReplace ? "" : " disabled") + ">Replace Existing</option>" +
              "<option value=\"rename\"" + (game.mode === "rename" ? " selected" : "") + ">Import Separately</option>" +
              "<option value=\"skip\"" + (game.mode === "skip" ? " selected" : "") + ">Skip</option>" +
            "</select>"
          )
        : (
            "<p class=\"bundle-preview-controls-hint\">" +
              (game.hasConflict
                ? ("Global: " + escapeHtml(globalConflictModeLabel(globalConflictMode)))
                : "Auto") +
            "</p>"
          );
      rows.push(
        "<div class=\"" + rowClass + "\">" +
          "<input type=\"checkbox\" data-action=\"toggle-select\" data-index=\"" + game.index + "\"" + (game.selected ? " checked" : "") + (game.isInvalid ? " disabled" : "") + ">" +
          "<div class=\"" + thumbClass + "\"" + thumbStyle + "></div>" +
          "<div class=\"bundle-preview-main\">" +
            "<p class=\"bundle-preview-title\">" + escapeHtml(game.name || "Imported Game") + "</p>" +
            "<p class=\"bundle-preview-meta\">" +
              formatBytes(game.totalBytes) + " • " + String(game.fileCount || 0) + " files • Startup: " + escapeHtml(game.entryPath || "-") +
            "</p>" +
            "<p class=\"" + statusClass + "\">" + escapeHtml(statusText) + "</p>" +
          "</div>" +
          "<div class=\"bundle-preview-controls\">" +
            modeControl +
          "</div>" +
        "</div>"
      );
    }
    bundlePreviewList.innerHTML = rows.join("");

    const summary = buildBundlePreviewPlanSummary();
    bundlePreviewPlan.textContent =
      "Planned: " + summary.selectedGames + " game(s), " +
      summary.selectedFiles + " file(s), " +
      formatBytes(summary.selectedBytes) + ". " +
      summary.importCount + " import, " +
      summary.replaceCount + " replace, " +
      summary.renameCount + " import separately, " +
      summary.skippedCount + " skipped.";
    bundlePreviewImportButton.disabled = summary.selectedGames === 0;
  }

function openBundlePreviewModal(preview) {
    return new Promise((resolve) => {
      const defaultGlobalConflictMode = preview.games.some((game) => game.canReplace) ? "replace" : "rename";
      state.bundlePreviewDraft = {
        fileName: preview.fileName,
        totalFiles: preview.totalFiles,
        totalBytes: preview.totalBytes,
        globalConflictMode: defaultGlobalConflictMode,
        individualConflictControl: false,
        games: preview.games.map((game) => ({
          index: game.index,
          sourceId: game.sourceId,
          name: game.normalizedGame ? game.normalizedGame.name : "Imported Game",
          entryPath: game.normalizedGame ? game.normalizedGame.entryPath : "",
          fileCount: game.fileCount,
          totalBytes: game.totalBytes,
          thumbnailDataUrl: game.thumbnailDataUrl || "",
          conflictName: game.conflictGame ? String(game.conflictGame.name || game.conflictGame.id || "") : "",
          canReplace: Boolean(game.conflictGame),
          hasConflict: Boolean(game.conflictGame),
          isInvalid: Boolean(game.missingPayloadCount),
          missingPayloadCount: game.missingPayloadCount,
          mode: game.defaultMode,
          selected: !game.missingPayloadCount && game.defaultMode !== "skip"
        }))
      };
      applyGlobalConflictModeToDraft();
      state.bundlePreviewResolver = resolve;
      renderBundlePreviewModal();
      bundlePreviewModal.classList.add("open");
      bundlePreviewModal.setAttribute("aria-hidden", "false");
      bundlePreviewImportButton.focus();
    });
  }

function renderGameCards() {
    const games = filteredGames();
    gamesGrid.innerHTML = "";
    if (state.libraryChecked && state.gamesById.size === 0) {
      emptyLibrary.textContent = "No saved games yet.";
      emptyLibrary.classList.add("visible");
      emptyLibrary.setAttribute("aria-hidden", "false");
    } else {
      emptyLibrary.textContent = "";
      emptyLibrary.classList.remove("visible");
      emptyLibrary.setAttribute("aria-hidden", "true");
    }
    const shouldAnimateEntry = !state.gameCardsEntryAnimated && games.length > 0;

    for (const game of games) {
      const selectedClass = game.id === state.selectedGameId ? " is-selected" : "";
      const hasThumb = typeof game.thumbnailDataUrl === "string" && game.thumbnailDataUrl.length > 0;
      const thumbClass = hasThumb ? "square-button" : "square-button no-thumb";
      const thumbStyle = hasThumb
        ? " style=\"background-image:url('" + escapeHtml(game.thumbnailDataUrl) + "');\""
        : "";
      const badgeItems = buildGameBadgeItemsMarkup(game, true);
      const badges = badgeItems
        ? "<span class=\"game-badges\" aria-hidden=\"true\">" + badgeItems + "</span>"
        : "";
      const card = document.createElement("div");
      card.className = "game-item" + selectedClass;
      card.dataset.gameId = game.id;
      card.innerHTML =
        "<button class=\"" + thumbClass + "\" data-action=\"select\" data-game-id=\"" + escapeHtml(game.id) + "\" type=\"button\"" + thumbStyle + ">" +
          badges +
          "<span class=\"game-edit-trigger\" data-action=\"edit-game\" data-game-id=\"" + escapeHtml(game.id) + "\" title=\"Edit game\" aria-label=\"Edit game\"></span>" +
        "</button>" +
        "<div class=\"game-info\">" +
          "<p class=\"game-title\">" + escapeHtml(game.name || "Untitled game") + "</p>" +
          "<div class=\"game-buttons\">" +
            "<button data-action=\"launch\" data-game-id=\"" + escapeHtml(game.id) + "\" type=\"button\">Play</button>" +
            "<button class=\"danger\" data-action=\"delete\" data-game-id=\"" + escapeHtml(game.id) + "\" type=\"button\">Delete</button>" +
          "</div>" +
        "</div>";
      gamesGrid.append(card);
    }

    if (shouldAnimateEntry) {
      queueGameCardEntryAnimation();
      state.gameCardsEntryAnimated = true;
    }
  }

function queueGameCardEntryAnimation() {
    const cards = Array.from(gamesGrid.querySelectorAll(".game-item"));
    if (!cards.length) {
      return;
    }
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    requestAnimationFrame(() => {
      const rowTops = [];
      const cardMeta = cards.map((card) => {
        const rect = card.getBoundingClientRect();
        let rowIndex = rowTops.findIndex((top) => Math.abs(top - rect.top) < 6);
        if (rowIndex === -1) {
          rowTops.push(rect.top);
          rowIndex = rowTops.length - 1;
        }
        return { card, rowIndex, left: rect.left };
      });

      const rowDelayStep = 100;
      const colDelayStep = 55;
      const rows = new Map();
      for (const item of cardMeta) {
        if (!rows.has(item.rowIndex)) {
          rows.set(item.rowIndex, []);
        }
        rows.get(item.rowIndex).push(item);
      }

      for (const [rowIndex, items] of rows) {
        items.sort((a, b) => a.left - b.left);
        items.forEach((item, colIndex) => {
          const delay = (rowIndex * rowDelayStep) + (colIndex * colDelayStep);
          item.card.style.setProperty("--entry-delay", delay + "ms");
          item.card.classList.add("is-entering");
          item.card.addEventListener("animationend", () => {
            item.card.classList.remove("is-entering");
            item.card.style.removeProperty("--entry-delay");
          }, { once: true });
        });
      }
    });
  }

function buildGameBadgeItemsMarkup(game, withTitles) {
    const titleAttr = (text) => withTitles ? " title=\"" + escapeHtml(text) + "\"" : "";
    const githubBadge = game && game.githubSource
      ? "<span class=\"game-github-badge\" aria-hidden=\"true\"" + titleAttr("Imported from GitHub") + "></span>"
      : "";
    const unityBadge = game && game.unityDetected
      ? "<span class=\"game-unity-badge\" aria-hidden=\"true\"" + titleAttr("Unity game") + "></span>"
      : "";
    const flashBadge = game && game.flashDetected
      ? "<span class=\"game-flash-badge\" aria-hidden=\"true\"" + titleAttr("Adobe Flash game") + "></span>"
      : "";
    return githubBadge + unityBadge + flashBadge;
  }

function updateGameEditPreviewThumbFromSource() {
    const src = String(gameEditCropImage.getAttribute("src") || "").trim();
    if (!src) {
      gameEditPreviewThumb.style.backgroundImage = "";
      gameEditPreviewThumb.classList.add("preview-empty");
      return;
    }
    gameEditPreviewThumb.style.backgroundImage = "url('" + src.replace(/'/g, "\\'") + "')";
    gameEditPreviewThumb.classList.remove("preview-empty");
  }

function updateGameEditPreviewFromCrop() {
    const cropper = state.gameEditEditor.cropper;
    if (!cropper) {
      updateGameEditPreviewThumbFromSource();
      return;
    }
    const cropped = cropper.getCroppedCanvas({
      width: 320,
      height: 320,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high"
    });
    if (!cropped) {
      updateGameEditPreviewThumbFromSource();
      return;
    }
    gameEditPreviewThumb.style.backgroundImage = "url('" + cropped.toDataURL("image/jpeg", 0.9) + "')";
    gameEditPreviewThumb.classList.remove("preview-empty");
  }

function scheduleGameEditPreviewFromCrop() {
    if (state.gameEditEditor.previewFrame) {
      cancelAnimationFrame(state.gameEditEditor.previewFrame);
    }
    state.gameEditEditor.previewFrame = requestAnimationFrame(() => {
      state.gameEditEditor.previewFrame = 0;
      updateGameEditPreviewFromCrop();
    });
  }

function initGameEditCropper() {
    if (!window.Cropper) {
      log("Game image cropper failed to load.", "error");
      return;
    }
    if (state.gameEditEditor.cropper) {
      state.gameEditEditor.cropper.destroy();
    }
    state.gameEditEditor.cropper = new Cropper(gameEditCropImage, {
      aspectRatio: 1,
      viewMode: 1,
      dragMode: "move",
      autoCropArea: 1,
      responsive: true,
      background: false,
      zoomable: true,
      movable: true,
      rotatable: false,
      scalable: false,
      guides: true,
      crop() {
        scheduleGameEditPreviewFromCrop();
      },
      ready() {
        const cropper = state.gameEditEditor.cropper;
        if (!cropper) {
          return;
        }
        cropper.reset();
        scheduleGameEditPreviewFromCrop();
      }
    });
  }

function setGameEditCropSource(sourceUrl) {
    if (!sourceUrl) {
      if (state.gameEditEditor.cropper) {
        state.gameEditEditor.cropper.destroy();
        state.gameEditEditor.cropper = null;
      }
      gameEditCropWrap.classList.add("is-empty");
      gameEditCropImage.removeAttribute("src");
      updateGameEditPreviewThumbFromSource();
      return;
    }
    gameEditCropWrap.classList.remove("is-empty");
    gameEditCropImage.onload = () => initGameEditCropper();
    gameEditCropImage.src = sourceUrl;
    updateGameEditPreviewThumbFromSource();
  }

function renderGameOptions(selectedId) {
    gameSelect.innerHTML = "";
    const games = sortedGames();

    if (!games.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No saved games yet";
      gameSelect.append(option);
      gameSelect.disabled = true;
      renderGameCards();
      return "";
    }

    gameSelect.disabled = false;
    for (const game of games) {
      const option = document.createElement("option");
      option.value = game.id;
      option.textContent = game.name;
      gameSelect.append(option);
    }

    const chosen = selectedId && state.gamesById.has(selectedId)
      ? selectedId
      : games[0].id;
    gameSelect.value = chosen;
    renderGameCards();
    return chosen;
  }

function setEmptyEntryState(message) {
    entrySelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = message;
    entrySelect.append(option);
    entrySelect.disabled = true;
  }

function populateEntryOptions(entryPaths, preferredPath) {
    const entries = (entryPaths || []).slice().sort((a, b) => a.localeCompare(b));
    if (!entries.length) {
      setEmptyEntryState("No .html startup file found");
      return "";
    }

    entrySelect.disabled = false;
    entrySelect.innerHTML = "";
    for (const path of entries) {
      const option = document.createElement("option");
      option.value = path;
      option.textContent = path;
      entrySelect.append(option);
    }

    const selected = chooseBestEntryPath(entries, preferredPath);
    entrySelect.value = selected;
    return selected;
  }

function animateStorageDonutTo(targetPct) {
    const clampedTarget = Math.max(0, Math.min(100, Number(targetPct) || 0));
    const startPct = Math.max(0, Math.min(100, Number(state.storageUsedPctDisplay) || 0));

    if (state.storagePctAnimationFrame) {
      cancelAnimationFrame(state.storagePctAnimationFrame);
      state.storagePctAnimationFrame = 0;
    }

    const applyPct = (value) => {
      const clamped = Math.max(0, Math.min(100, Number(value) || 0));
      state.storageUsedPctDisplay = clamped;
      if (storageDonut) {
        storageDonut.style.setProperty("--used-pct", clamped.toFixed(1));
      }
      if (storageUsedPct) {
        storageUsedPct.textContent = Math.round(clamped) + "%";
      }
    };

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      applyPct(clampedTarget);
      return;
    }

    const delta = clampedTarget - startPct;
    if (Math.abs(delta) < 0.1) {
      applyPct(clampedTarget);
      return;
    }

    const duration = Math.max(360, Math.min(1100, Math.abs(delta) * 14));
    const startedAt = performance.now();

    const tick = (now) => {
      const elapsed = now - startedAt;
      const progress = Math.max(0, Math.min(1, elapsed / duration));
      const eased = 1 - Math.pow(1 - progress, 3);
      applyPct(startPct + (delta * eased));
      if (progress < 1) {
        state.storagePctAnimationFrame = requestAnimationFrame(tick);
      } else {
        state.storagePctAnimationFrame = 0;
        applyPct(clampedTarget);
      }
    };

    state.storagePctAnimationFrame = requestAnimationFrame(tick);
  }

async function refreshStorageSummary() {
    const games = Array.from(state.gamesById.values());
    const totalBytes = games.reduce((sum, game) => sum + (Number(game.totalBytes) || 0), 0);

    libraryCount.textContent = String(games.length);
    libraryBytes.textContent = formatBytes(totalBytes);

    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const hasUsage = estimate && typeof estimate.usage === "number";
        const hasQuota = estimate && typeof estimate.quota === "number";
        if (hasUsage && hasQuota) {
          quotaUsage.textContent = formatBytes(estimate.usage) + " / " + formatBytes(estimate.quota);
          animateStorageDonutTo((estimate.usage / Math.max(1, estimate.quota)) * 100);
        } else {
          quotaUsage.textContent = "Unavailable";
          animateStorageDonutTo(0);
        }
      } catch {
        quotaUsage.textContent = "Unavailable";
        animateStorageDonutTo(0);
      }
    } else {
      quotaUsage.textContent = "Unsupported";
      animateStorageDonutTo(0);
    }
  }

function updateSelectedGameInfo(game) {
    if (!game) {
      gameMeta.textContent = "No saved game selected.";
      selectedSubtext.textContent = "Pick a game and press Play.";
      selectedThumb.classList.add("no-thumb");
      selectedThumb.style.backgroundImage = "";
      selectedImported.textContent = "-";
      selectedSize.textContent = "-";
      selectedEntry.textContent = "-";
      selectedPlayButton.disabled = true;
      selectedEditButton.disabled = true;
      selectedDeleteButton.disabled = true;
      setEmptyEntryState("Select a saved game");
      return;
    }

    gameMeta.textContent = game.name || "Selected game";
    selectedSubtext.textContent = "Ready to launch";
    if (typeof game.thumbnailDataUrl === "string" && game.thumbnailDataUrl) {
      selectedThumb.classList.remove("no-thumb");
      selectedThumb.style.backgroundImage = "url('" + game.thumbnailDataUrl + "')";
    } else {
      selectedThumb.classList.add("no-thumb");
      selectedThumb.style.backgroundImage = "";
    }
    selectedImported.textContent = formatDate(game.importedAt);
    selectedSize.textContent = formatBytes(game.totalBytes || 0);
    selectedPlayButton.disabled = false;
    selectedEditButton.disabled = false;
    selectedDeleteButton.disabled = false;

    const chosenEntry = populateEntryOptions(game.htmlEntries || [], game.entryPath || "");
    selectedEntry.textContent = chosenEntry || game.entryPath || "-";
    if (chosenEntry && chosenEntry !== game.entryPath) {
      game.entryPath = chosenEntry;
      state.gamesById.set(game.id, game);
      putGame(game).catch((error) => {
        console.error(error);
        log("Could not persist startup file for " + game.name + ".", "error");
      });
    }
  }

function buildBundlePreviewPlanSummary() {
    const draft = state.bundlePreviewDraft;
    if (!draft || !Array.isArray(draft.games)) {
      return {
        selectedGames: 0,
        importCount: 0,
        replaceCount: 0,
        renameCount: 0,
        skippedCount: 0,
        invalidCount: 0,
        selectedFiles: 0,
        selectedBytes: 0
      };
    }
    const summary = {
      selectedGames: 0,
      importCount: 0,
      replaceCount: 0,
      renameCount: 0,
      skippedCount: 0,
      invalidCount: 0,
      selectedFiles: 0,
      selectedBytes: 0
    };
    for (const game of draft.games) {
      const selected = Boolean(game.selected);
      const mode = game.mode || "skip";
      const isInvalid = Boolean(game.isInvalid);
      if (isInvalid) {
        summary.invalidCount += 1;
      }
      if (!selected || mode === "skip" || isInvalid) {
        summary.skippedCount += 1;
        continue;
      }
      summary.selectedGames += 1;
      summary.selectedFiles += game.fileCount || 0;
      summary.selectedBytes += game.totalBytes || 0;
      if (mode === "replace") {
        summary.replaceCount += 1;
      } else if (mode === "rename") {
        summary.renameCount += 1;
      } else {
        summary.importCount += 1;
      }
    }
    return summary;
  }

function applyGlobalConflictModeToDraft() {
    const draft = state.bundlePreviewDraft;
    if (!draft || !Array.isArray(draft.games)) {
      return;
    }
    const globalMode = String(draft.globalConflictMode || "replace");
    for (const game of draft.games) {
      if (!game || !game.hasConflict || game.isInvalid) {
        continue;
      }
      if (!game.selected) {
        continue;
      }
      game.mode = globalMode;
      if (globalMode === "skip") {
        game.selected = false;
      }
    }
  }

function globalConflictModeLabel(mode) {
    if (mode === "replace") {
      return "Replace Existing";
    }
    if (mode === "rename") {
      return "Import Separately";
    }
    return "Skip Conflicts";
  }

function cycleGlobalConflictMode(mode) {
    if (mode === "replace") {
      return "rename";
    }
    if (mode === "rename") {
      return "skip";
    }
    return "replace";
  }
