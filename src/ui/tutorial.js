"use strict";

const EXAMPLE_TUTORIAL_GAME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Example Click Game</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    font-family: "Segoe UI", system-ui, sans-serif;
    background: radial-gradient(circle at top, #2b3558, #12141c 65%);
    color: #f4f6ff;
  }
  .panel {
    width: min(420px, 92vw);
    padding: 24px;
    border-radius: 18px;
    background: rgba(18, 20, 30, 0.88);
    border: 1px solid rgba(255, 255, 255, 0.12);
    text-align: center;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
  }
  h1 { margin: 0 0 8px; font-size: 1.55rem; }
  p { margin: 0 0 18px; color: #c9d0e8; }
  #score { font-weight: 700; color: #ffe566; }
  #arena {
    position: relative;
    height: 220px;
    border-radius: 14px;
    background: linear-gradient(180deg, #1b2236, #141926);
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  #target {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 72px;
    height: 72px;
    margin: -36px 0 0 -36px;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    color: #1a1400;
    font-weight: 700;
    background: radial-gradient(circle at 30% 30%, #ffe566, #f0b400);
    box-shadow: 0 0 0 4px rgba(245, 208, 0, 0.25), 0 10px 24px rgba(0, 0, 0, 0.35);
    transition: transform 0.12s ease;
  }
  #target:active { transform: scale(0.92); }
</style>
</head>
<body>
  <div class="panel">
    <h1>Example Click Game</h1>
    <p>Click the glowing target. Score: <span id="score">0</span></p>
    <div id="arena"><button id="target" type="button">Go</button></div>
  </div>
  <script>
    const arena = document.getElementById("arena");
    const target = document.getElementById("target");
    const scoreEl = document.getElementById("score");
    let score = 0;
    function moveTarget() {
      const size = 72;
      const maxX = Math.max(0, arena.clientWidth - size);
      const maxY = Math.max(0, arena.clientHeight - size);
      target.style.left = (Math.random() * maxX + size / 2) + "px";
      target.style.top = (Math.random() * maxY + size / 2) + "px";
      target.style.margin = (-size / 2) + "px 0 0 " + (-size / 2) + "px";
    }
    target.addEventListener("click", function () {
      score += 1;
      scoreEl.textContent = String(score);
      moveTarget();
    });
    moveTarget();
  </script>
</body>
</html>`;

const tutorialUi = {
  root: document.getElementById("tutorialRoot"),
  spotlight: document.getElementById("tutorialSpotlight"),
  note: document.getElementById("tutorialNote"),
  noteTitle: document.getElementById("tutorialNoteTitle"),
  noteBody: document.getElementById("tutorialNoteBody"),
  noteActions: document.getElementById("tutorialNoteActions"),
  skipButton: document.getElementById("tutorialSkip"),
  blockerTop: document.getElementById("tutorialBlockerTop"),
  blockerLeft: document.getElementById("tutorialBlockerLeft"),
  blockerRight: document.getElementById("tutorialBlockerRight"),
  blockerBottom: document.getElementById("tutorialBlockerBottom")
};

const tutorialState = {
  active: false,
  step: "",
  targetEl: null,
  resizeBound: false,
  repositionFrame: 0,
  settleTimer: 0
};

function isTutorialActive() {
  return Boolean(tutorialState.active);
}

function getTutorialStep() {
  return tutorialState.step || "";
}

async function markTutorialCompleted() {
  try {
    await putSetting(SETTING_TUTORIAL_COMPLETED, true);
  } catch (error) {
    console.error(error);
  }
}

function clearTutorialHighlightClass() {
  for (const el of document.querySelectorAll(".tutorial-target-glow")) {
    el.classList.remove("tutorial-target-glow");
  }
}

function hideTutorialChrome() {
  if (tutorialState.repositionFrame) {
    cancelAnimationFrame(tutorialState.repositionFrame);
    tutorialState.repositionFrame = 0;
  }
  if (tutorialState.settleTimer) {
    clearTimeout(tutorialState.settleTimer);
    tutorialState.settleTimer = 0;
  }
  clearTutorialHighlightClass();
  tutorialState.targetEl = null;
  if (tutorialUi.spotlight) {
    tutorialUi.spotlight.hidden = true;
  }
  if (tutorialUi.note) {
    tutorialUi.note.hidden = true;
    tutorialUi.note.classList.remove("is-docked-right", "is-docked-below", "is-docked-center", "is-docked-left");
  }
  if (tutorialUi.noteActions) {
    tutorialUi.noteActions.innerHTML = "";
  }
  positionTutorialBlockers(null);
}

function pauseTutorialOverlay() {
  hideTutorialChrome();
  if (tutorialUi.root) {
    tutorialUi.root.hidden = true;
    tutorialUi.root.setAttribute("aria-hidden", "true");
  }
}

function resumeTutorialOverlay() {
  if (!tutorialState.active || !tutorialUi.root) {
    return;
  }
  tutorialUi.root.hidden = false;
  tutorialUi.root.setAttribute("aria-hidden", "false");
}

function stopTutorial(options = {}) {
  const markDone = options.markDone !== false;
  tutorialState.active = false;
  tutorialState.step = "";
  hideTutorialChrome();
  if (tutorialUi.root) {
    tutorialUi.root.hidden = true;
    tutorialUi.root.setAttribute("aria-hidden", "true");
    tutorialUi.root.classList.remove("is-active");
  }
  if (markDone) {
    markTutorialCompleted();
  }
}

function ensureTutorialResizeListener() {
  if (tutorialState.resizeBound) {
    return;
  }
  tutorialState.resizeBound = true;
  window.addEventListener("resize", () => {
    if (!tutorialState.active) {
      return;
    }
    scheduleTutorialReposition();
  });
  window.addEventListener("scroll", () => {
    if (!tutorialState.active) {
      return;
    }
    scheduleTutorialReposition();
  }, true);
}

function scheduleTutorialReposition(options = {}) {
  const delayMs = Number(options.afterMs) || 0;
  const trackMs = Number(options.trackMs) || 0;
  if (tutorialState.repositionFrame) {
    cancelAnimationFrame(tutorialState.repositionFrame);
    tutorialState.repositionFrame = 0;
  }
  if (tutorialState.settleTimer) {
    clearTimeout(tutorialState.settleTimer);
    tutorialState.settleTimer = 0;
  }
  const run = () => {
    tutorialState.settleTimer = 0;
    if (trackMs > 0) {
      const start = performance.now();
      let first = true;
      const tick = (now) => {
        tutorialState.repositionFrame = 0;
        repositionTutorialChrome({ scroll: first });
        first = false;
        if (!tutorialState.active) {
          return;
        }
        if (now - start < trackMs) {
          tutorialState.repositionFrame = requestAnimationFrame(tick);
        }
      };
      tutorialState.repositionFrame = requestAnimationFrame(tick);
      return;
    }
    tutorialState.repositionFrame = requestAnimationFrame(() => {
      tutorialState.repositionFrame = 0;
      repositionTutorialChrome();
    });
  };
  if (delayMs > 0) {
    tutorialState.settleTimer = window.setTimeout(run, delayMs);
  } else {
    run();
  }
}

function createTutorialActionButton(label, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (options.primary) {
    button.dataset.variant = "replace";
  }
  if (typeof options.onClick === "function") {
    button.addEventListener("click", options.onClick);
  }
  return button;
}

function setTutorialNote(title, bodyHtml, actionButtons, options = {}) {
  if (!tutorialUi.note || !tutorialUi.noteTitle || !tutorialUi.noteBody || !tutorialUi.noteActions) {
    return;
  }
  tutorialUi.noteTitle.textContent = title || "";
  tutorialUi.noteBody.innerHTML = bodyHtml || "";
  tutorialUi.noteActions.innerHTML = "";
  for (const button of actionButtons || []) {
    tutorialUi.noteActions.append(button);
  }
  if (tutorialUi.skipButton) {
    tutorialUi.skipButton.hidden = Boolean(options.hideSkip);
  }
  tutorialUi.note.hidden = false;
}

function positionTutorialBlockers(holeRect) {
  const top = tutorialUi.blockerTop;
  const left = tutorialUi.blockerLeft;
  const right = tutorialUi.blockerRight;
  const bottom = tutorialUi.blockerBottom;
  if (!top || !left || !right || !bottom) {
    return;
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!holeRect) {
    top.style.cssText = "left:0;top:0;width:100%;height:100%;";
    left.style.cssText = "display:none;";
    right.style.cssText = "display:none;";
    bottom.style.cssText = "display:none;";
    return;
  }
  const x = Math.max(0, holeRect.left);
  const y = Math.max(0, holeRect.top);
  const w = Math.max(0, holeRect.width);
  const h = Math.max(0, holeRect.height);
  top.style.cssText = "display:block;left:0;top:0;width:100%;height:" + y + "px;";
  left.style.cssText = "display:block;left:0;top:" + y + "px;width:" + x + "px;height:" + h + "px;";
  right.style.cssText =
    "display:block;left:" + (x + w) + "px;top:" + y + "px;width:" + Math.max(0, vw - x - w) + "px;height:" + h + "px;";
  bottom.style.cssText =
    "display:block;left:0;top:" + (y + h) + "px;width:100%;height:" + Math.max(0, vh - y - h) + "px;";
}

function positionTutorialNote(rect, mode) {
  if (!tutorialUi.note || tutorialUi.note.hidden) {
    return;
  }
  const note = tutorialUi.note;
  note.classList.remove("is-docked-right", "is-docked-below", "is-docked-center", "is-docked-left");
  note.style.left = "";
  note.style.top = "";
  note.style.right = "";
  note.style.bottom = "";
  note.style.transform = "";

  const gap = 16;
  const noteWidth = Math.min(360, window.innerWidth - 24);
  note.style.width = noteWidth + "px";

  if (mode === "center" || !rect) {
    note.classList.add("is-docked-center");
    note.style.left = "50%";
    note.style.top = "50%";
    note.style.transform = "translate(-50%, -50%)";
    return;
  }

  if (mode === "left") {
    note.classList.add("is-docked-left");
    const left = Math.max(12, rect.left - noteWidth - gap);
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - 24));
    note.style.left = left + "px";
    note.style.top = top + "px";
    return;
  }

  const spaceRight = window.innerWidth - rect.right;
  if (mode === "right" || (mode !== "below" && spaceRight >= noteWidth + gap + 8)) {
    note.classList.add("is-docked-right");
    const left = Math.min(window.innerWidth - noteWidth - 12, rect.right + gap);
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - 24));
    note.style.left = left + "px";
    note.style.top = top + "px";
    return;
  }

  note.classList.add("is-docked-below");
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - noteWidth - 12));
  const top = Math.min(window.innerHeight - 12, rect.bottom + gap);
  note.style.left = left + "px";
  note.style.top = top + "px";
}

function repositionTutorialChrome(options = {}) {
  if (!tutorialState.active) {
    return;
  }
  const target = tutorialState.targetEl;
  if (!target || !document.contains(target)) {
    if (tutorialUi.spotlight) {
      tutorialUi.spotlight.hidden = true;
    }
    positionTutorialBlockers(null);
    positionTutorialNote(null, "center");
    return;
  }

  if (options.scroll !== false) {
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  const rect = target.getBoundingClientRect();
  const pad = 8;
  const hole = {
    left: Math.max(0, rect.left - pad),
    top: Math.max(0, rect.top - pad),
    width: Math.max(0, rect.width + pad * 2),
    height: Math.max(0, rect.height + pad * 2)
  };
  if (tutorialUi.spotlight) {
    tutorialUi.spotlight.hidden = false;
    tutorialUi.spotlight.style.left = hole.left + "px";
    tutorialUi.spotlight.style.top = hole.top + "px";
    tutorialUi.spotlight.style.width = hole.width + "px";
    tutorialUi.spotlight.style.height = hole.height + "px";
  }
  positionTutorialBlockers(hole);

  const step = tutorialState.step;
  if (step === "manage" || step === "addGames") {
    positionTutorialNote(rect, "right");
  } else if (step === "editName" || step === "editImage" || step === "editSave" || step === "editAgain") {
    positionTutorialNote(rect, "left");
  } else if (step === "launch") {
    positionTutorialNote(rect, "left");
  } else {
    positionTutorialNote(rect, "below");
  }
}

function focusTutorialTarget(el, options = {}) {
  clearTutorialHighlightClass();
  tutorialState.targetEl = el || null;
  if (el && options.glow !== false) {
    el.classList.add("tutorial-target-glow");
  }
  scheduleTutorialReposition({
    afterMs: Number(options.afterMs) || 0,
    trackMs: Number(options.trackMs) || 0
  });
}

function softClearTutorialSpotlight() {
  clearTutorialHighlightClass();
  tutorialState.targetEl = null;
  if (tutorialUi.spotlight) {
    tutorialUi.spotlight.hidden = true;
  }
  positionTutorialBlockers(null);
}

function showAddGamesTutorialNote() {
  const actions = [
    createTutorialActionButton("Use Example Game", {
      primary: true,
      onClick: () => {
        importExampleTutorialGame().catch((error) => {
          console.error(error);
          log("Example import failed: " + (error.message || String(error)), "error");
        });
      }
    })
  ];
  setTutorialNote(
    "Add your first game",
    "<p><strong>Import ZIP</strong> — load a local <code>.zip</code> of an HTML5, Unity WebGL, or Flash game.</p>" +
      "<p><strong>Import from GitHub</strong> — paste <code>owner/repo</code> or a repo / zip URL. For instance <a class=\"tutorial-link\" href=\"https://github.com/landgreen/n-gon\" target=\"_blank\" rel=\"noopener noreferrer\">https://github.com/landgreen/n-gon</a></p>" +
      "<p><strong>Replace Game with ZIP</strong> — swap files for a game you already saved (useful for updating).</p>" +
      "<div class=\"tutorial-callout\">" +
      "<strong>What games work?</strong>" +
      "<ul>" +
      "<li><strong>HTML5:</strong> an <code>index.html</code> (or other start <code>*.html</code>) plus JS.</li>" +
      "<li><strong>Unity WebGL:</strong> often <code>Build/</code> and <code>TemplateData/</code>.</li>" +
      "<li><strong>Flash:</strong> a <code>*.swf</code> (often with Ruffle).</li>" +
      "</ul>" +
      "<p>Games that need a real web server (<code>server.js</code> / npm) or rely on service workers (<code>sw.js</code>) may break. No start <code>*.html</code> usually means it is not ready.</p>" +
      "</div>" +
      "<p>No zip handy? Use the example HTML game below — it imports instantly.</p>",
    actions
  );
}

function showManageTutorialStep() {
  tutorialState.step = "manage";
  resumeTutorialOverlay();
  setTutorialNote(
    "Welcome — let's add a game",
    "<p>Start here. Click <strong>Manage Games</strong> to open imports, updates, and backups.</p>",
    []
  );
  focusTutorialTarget(openOpsModalButton);
}

function showAddGamesTutorialStep() {
  tutorialState.step = "addGames";
  resumeTutorialOverlay();
  showAddGamesTutorialNote();
  // Track the sheet while it slides up so the highlight stays aligned.
  focusTutorialTarget(document.getElementById("opsAddGamesGroup"), { trackMs: 320 });
}

function showEditNameTutorialStep() {
  tutorialState.step = "editName";
  resumeTutorialOverlay();
  const actions = [
    createTutorialActionButton("Next", {
      primary: true,
      onClick: () => showEditImageTutorialStep()
    })
  ];
  setTutorialNote(
    "Name your game (optional)",
    "<p>You can rename it in the <strong>Game name</strong> field. Skip renaming if you like — nothing is forced.</p>",
    actions
  );
  focusTutorialTarget(document.querySelector(".game-edit-name") || gameEditNameInput, { trackMs: 160 });
}

function showEditImageTutorialStep() {
  tutorialState.step = "editImage";
  const actions = [
    createTutorialActionButton("Use Example Image", {
      primary: true,
      onClick: () => {
        applyExampleTutorialImage();
        showEditSaveTutorialStep();
      }
    }),
    createTutorialActionButton("Skip", {
      onClick: () => showEditSaveTutorialStep()
    })
  ];
  setTutorialNote(
    "Add a cover image",
    "<p>Click <strong>Choose Image</strong> to pick your own, use the example cover, or skip.</p>",
    actions
  );
  focusTutorialTarget(uploadGameEditImageButton);
}

function showEditSaveTutorialStep() {
  tutorialState.step = "editSave";
  setTutorialNote(
    "Save your changes",
    "<p>Click <strong>Save Changes</strong> to keep the name and image, then return to your library.</p>",
    []
  );
  focusTutorialTarget(saveGameEditChangesButton);
}

function showEditAgainTutorialStep() {
  tutorialState.step = "editAgain";
  resumeTutorialOverlay();
  const actions = [
    createTutorialActionButton("Next: Launch a game", {
      primary: true,
      onClick: () => showLaunchTutorialStep()
    })
  ];
  setTutorialNote(
    "Edit anytime",
    "<p>Want to change the name or cover later? Select the game, then press <strong>Edit</strong> here — or use the edit control on the game card.</p>" +
      "<p>You can also reopen <strong>Manage Games</strong> from the left panel whenever you need imports again.</p>",
    actions
  );
  focusTutorialTarget(selectedEditButton);
}

function showLaunchTutorialStep() {
  tutorialState.step = "launch";
  resumeTutorialOverlay();
  const actions = [
    createTutorialActionButton("Finish tutorial", {
      onClick: () => stopTutorial({ markDone: true })
    })
  ];
  setTutorialNote(
    "Launch your game",
    "<p>Select a game card if needed, then press <strong>Play</strong> here (or Play on the card). Double-clicking a card also launches.</p>",
    actions,
    { hideSkip: true }
  );
  focusTutorialTarget(selectedPlayButton);
}

function createExampleTutorialThumbnailDataUrl() {
  return "data:image/jpeg;base64,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";
}

function applyExampleTutorialImage() {
  const dataUrl = createExampleTutorialThumbnailDataUrl();
  if (!dataUrl) {
    log("Could not create example image.", "error");
    return;
  }
  setGameEditCropSource(dataUrl);
  log("Example cover image applied.");
}

async function importExampleTutorialGame() {
  if (!state.db) {
    throw new Error("Database is not ready yet.");
  }
  setActionButtonsDisabled(true);
  try {
    setWorkProgress("Importing example game", 0, 1);
    const gameId = makeId();
    const path = "index.html";
    const bytes = new TextEncoder().encode(EXAMPLE_TUTORIAL_GAME_HTML);
    const blob = new Blob([bytes], { type: "text/html;charset=utf-8" });
    const gameRecord = {
      id: gameId,
      name: "Example Click Game",
      zipName: "example-click-game.html",
      importedAt: Date.now(),
      extractorVersion: CURRENT_EXTRACTOR_VERSION,
      sortOrder: getNextSortOrder(),
      fileCount: 1,
      totalBytes: blob.size,
      htmlEntries: [path],
      entryPath: path,
      thumbnailDataUrl: "",
      githubSource: null,
      unityDetected: false,
      flashDetected: false
    };

    await putFileRecord({
      gameId,
      path,
      size: blob.size,
      type: blob.type,
      blob,
      transformations: []
    });
    await putGame(gameRecord);
    state.selectedGameId = gameId;
    await putSetting(SETTING_SELECTED_GAME, gameId);
    await loadLibrary(gameId);
    log("Saved example game \"" + gameRecord.name + "\" (" + formatBytes(blob.size) + ")");
    tutorialState.step = "awaitEdit";
    // Keep the overlay up and just clear the old spotlight so the edit step feels instant.
    softClearTutorialSpotlight();
    setTutorialNote(
      "Opening editor…",
      "<p>Next you can rename the game and set a cover image.</p>",
      [],
      { hideSkip: true }
    );
    openGameEditModal(gameId);
  } finally {
    setActionButtonsDisabled(false);
    clearWorkProgress();
  }
}

function onTutorialOpsOpened() {
  if (!tutorialState.active) {
    return;
  }
  if (tutorialState.step === "manage" || tutorialState.step === "addGames") {
    showAddGamesTutorialStep();
  }
}

function onTutorialOpsClosed() {
  if (!tutorialState.active) {
    return;
  }
  if (tutorialState.step === "addGames") {
    showManageTutorialStep();
  }
}

function onTutorialEditOpened() {
  if (!tutorialState.active) {
    return;
  }
  if (
    tutorialState.step === "addGames" ||
    tutorialState.step === "awaitEdit" ||
    tutorialState.step === "manage"
  ) {
    showEditNameTutorialStep();
  } else if (tutorialState.step === "editAgain") {
    tutorialState.step = "editAgainVisit";
    pauseTutorialOverlay();
  } else if (
    tutorialState.step === "editName" ||
    tutorialState.step === "editImage" ||
    tutorialState.step === "editSave"
  ) {
    scheduleTutorialReposition({ afterMs: 80 });
  }
}

function onTutorialEditClosed() {
  if (!tutorialState.active) {
    return;
  }
  if (tutorialState.step === "editAgainVisit") {
    showEditAgainTutorialStep();
    return;
  }
  if (
    tutorialState.step === "editName" ||
    tutorialState.step === "editImage" ||
    tutorialState.step === "editSave" ||
    tutorialState.step === "awaitEdit"
  ) {
    showEditAgainTutorialStep();
  }
}

function onTutorialEditSaved() {
  if (!tutorialState.active) {
    return;
  }
  if (tutorialState.step === "editAgainVisit") {
    showEditAgainTutorialStep();
    return;
  }
  if (
    tutorialState.step === "editName" ||
    tutorialState.step === "editImage" ||
    tutorialState.step === "editSave" ||
    tutorialState.step === "awaitEdit"
  ) {
    showEditAgainTutorialStep();
  }
}

function onTutorialGameLaunched() {
  if (!tutorialState.active) {
    return;
  }
  if (tutorialState.step === "launch" || tutorialState.step === "editAgain") {
    stopTutorial({ markDone: true });
  }
}

function onTutorialZipImportStarted() {
  if (!tutorialState.active) {
    return;
  }
  if (tutorialState.step === "addGames") {
    tutorialState.step = "awaitEdit";
    softClearTutorialSpotlight();
    setTutorialNote(
      "Importing…",
      "<p>Hang tight — the editor opens next so you can name the game and pick a cover.</p>",
      [],
      { hideSkip: true }
    );
    resumeTutorialOverlay();
  }
}

function startTutorial() {
  if (!tutorialUi.root) {
    return;
  }
  if (typeof hideHowToModal === "function") {
    hideHowToModal();
  }
  if (typeof hideOpsModal === "function") {
    hideOpsModal(true);
  }
  if (typeof closeGameEditModal === "function" && gameEditModal && gameEditModal.classList.contains("open")) {
    closeGameEditModal({ skipTutorial: true });
  }

  ensureTutorialResizeListener();
  tutorialState.active = true;
  tutorialUi.root.hidden = false;
  tutorialUi.root.setAttribute("aria-hidden", "false");
  tutorialUi.root.classList.add("is-active");
  if (tutorialUi.skipButton && !tutorialUi.skipButton.dataset.bound) {
    tutorialUi.skipButton.dataset.bound = "1";
    tutorialUi.skipButton.addEventListener("click", () => {
      stopTutorial({ markDone: true });
      log("Tutorial skipped.");
    });
  }
  showManageTutorialStep();
}

function restartTutorial() {
  if (tutorialState.active) {
    stopTutorial({ markDone: false });
  }
  startTutorial();
  log("Tutorial started.");
}

async function maybeStartTutorial() {
  if (!tutorialUi.root) {
    return;
  }
  const forceTutorial = new URLSearchParams(window.location.search).get("tutorial") === "1";
  let completed = false;
  try {
    completed = Boolean(await getSetting(SETTING_TUTORIAL_COMPLETED));
  } catch (error) {
    console.error(error);
  }
  if (completed && !forceTutorial) {
    return;
  }
  if (!forceTutorial && state.gamesById.size > 0) {
    await markTutorialCompleted();
    return;
  }

  startTutorial();
}
