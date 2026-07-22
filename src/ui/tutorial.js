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
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "";
  }
  const gradient = ctx.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, "#2b3558");
  gradient.addColorStop(0.55, "#1a2034");
  gradient.addColorStop(1, "#f0b400");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);

  ctx.beginPath();
  ctx.arc(256, 230, 110, 0, Math.PI * 2);
  ctx.fillStyle = "#ffe566";
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(26, 20, 0, 0.55)";
  ctx.stroke();

  ctx.fillStyle = "#1a1400";
  ctx.font = "700 64px Poppins, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("GO", 256, 230);

  ctx.fillStyle = "#ffffff";
  ctx.font = "600 36px Poppins, Segoe UI, sans-serif";
  ctx.fillText("Example Game", 256, 400);
  return canvas.toDataURL("image/jpeg", 0.92);
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
