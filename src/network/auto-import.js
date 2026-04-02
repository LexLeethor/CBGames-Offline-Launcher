"use strict";

// Key used to prevent re-importing the same setup on reload
function getSetupDoneKey(setup) {
  const ids = (setup.bundles || []).map((b) => String(b.id || b.name || "")).join("|");
  return "cbgames_setup_done_" + ids.slice(0, 128);
}

async function importFileItem(file, item, itemPct, itemPctEnd, appendLog, setProgress) {
  const label = String(item.name || file.name);
  setProgress(itemPct + (itemPctEnd - itemPct) * 0.6, "Parsing " + label + "...");
  appendLog("Parsing " + label + "...");

  if (item.type === "bundle") {
    setActionButtonsDisabled(true);
    let previewData;
    try {
      previewData = await parseBundlePreviewData(file);
    } finally {
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }
    const planGames = previewData.games.map((preview) => ({
      preview,
      selected: !preview.missingPayloadCount,
      mode: "rename"
    }));
    setProgress(itemPct + (itemPctEnd - itemPct) * 0.8, "Importing " + label + "...");
    appendLog("Importing " + previewData.games.length + " game(s) from " + label + "...");
    setActionButtonsDisabled(true);
    try {
      await executeBundleImportPlan(previewData, planGames);
    } finally {
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }
  } else {
    setProgress(itemPct + (itemPctEnd - itemPct) * 0.8, "Importing " + label + "...");
    setActionButtonsDisabled(true);
    try {
      await importZipFile(file, { importMode: "separate" });
    } finally {
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }
  }
}

async function runAutoImport(setup) {
  const bundles = Array.isArray(setup) ? setup : (setup && Array.isArray(setup.bundles) ? setup.bundles : []);
  if (!bundles.length) return;

  // Guard: skip if this exact setup was already imported (prevents re-import on reload)
  const doneKey = getSetupDoneKey({ bundles });
  if (typeof localStorage !== "undefined" && localStorage.getItem(doneKey)) return;

  const mode = (setup && setup.mode) || "network"; // "network" or "local"

  const modal = document.getElementById("autoImportModal");
  const statusEl = document.getElementById("autoImportStatusText");
  const logEl = document.getElementById("autoImportLog");
  const closeBtn = document.getElementById("autoImportCloseBtn");
  const progressBar = document.getElementById("autoImportProgressFill");
  const progressLabel = document.getElementById("autoImportProgressLabel");
  const folderPickerWrap = document.getElementById("autoImportFolderPickerWrap");
  const folderPickerBtn = document.getElementById("autoImportFolderPickerBtn");

  if (!modal) return;

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");

  function appendLog(text, tone) {
    if (!logEl) return;
    const el = document.createElement("div");
    el.className = "auto-import-log-item" + (tone ? " " + tone : "");
    el.textContent = text;
    logEl.append(el);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setProgress(pct, label) {
    if (progressBar) progressBar.style.width = Math.min(100, Math.max(0, pct)) + "%";
    if (progressLabel) progressLabel.textContent = label || "";
  }

  async function doImport(getFileForItem) {
    let imported = 0;
    let failed = 0;
    for (let i = 0; i < bundles.length; i++) {
      const item = bundles[i];
      const label = String(item.name || "bundle-" + (i + 1));
      const itemPct = (i / bundles.length) * 100;
      const itemPctEnd = ((i + 1) / bundles.length) * 100;
      try {
        const file = await getFileForItem(item, i, itemPct, itemPctEnd);
        await importFileItem(file, item, itemPct, itemPctEnd, appendLog, setProgress);
        imported++;
        setProgress(itemPctEnd, "Done: " + label);
        appendLog("Imported: " + label, "success");
      } catch (err) {
        failed++;
        setActionButtonsDisabled(false);
        clearWorkProgress();
        setProgress(itemPctEnd, "Failed: " + label);
        appendLog("Failed: " + label + " — " + (err && err.message ? err.message : String(err)), "error");
      }
    }
    setProgress(100, "Complete.");
    if (statusEl) {
      statusEl.textContent = imported + " imported" + (failed ? ", " + failed + " failed." : " successfully.");
    }
    if (failed === 0) {
      try { localStorage.setItem(doneKey, "1"); } catch {}
    }
    if (closeBtn) { closeBtn.disabled = false; closeBtn.focus(); }
  }

  if (mode === "local") {
    if (statusEl) statusEl.textContent = bundles.length + " bundle(s) saved in your launcher folder.";
    appendLog("Click 'Select Launcher Folder' to begin importing.");
    if (folderPickerWrap) folderPickerWrap.hidden = false;

    if (folderPickerBtn) {
      folderPickerBtn.addEventListener("click", async () => {
        if (!window.showDirectoryPicker) {
          appendLog("File System Access API not supported in this browser.", "error");
          return;
        }
        let dirHandle;
        try {
          dirHandle = await window.showDirectoryPicker({ mode: "read" });
        } catch (err) {
          if (err && err.name === "AbortError") return;
          appendLog("Folder selection failed: " + (err.message || String(err)), "error");
          return;
        }
        if (folderPickerWrap) folderPickerWrap.hidden = true;
        if (statusEl) statusEl.textContent = "Importing " + bundles.length + " bundle(s)...";
        await doImport(async (item, i, itemPct, itemPctEnd) => {
          const label = String(item.name || "bundle-" + (i + 1));
          appendLog("Reading " + label + " from folder...");
          setProgress(itemPct, "Reading " + label + "...");
          const fileHandle = await dirHandle.getFileHandle(item.fileName || item.name);
          return fileHandle.getFile();
        });
      });
    }
  } else {
    // Network mode: auto-download from host
    if (statusEl) statusEl.textContent = "Auto-importing " + bundles.length + " bundle(s) from host...";
    await doImport(async (item, i, itemPct, itemPctEnd) => {
      const label = String(item.name || "bundle-" + (i + 1));
      appendLog("Downloading " + label + "...");
      setProgress(itemPct, "Downloading " + label + "...");
      setActionButtonsDisabled(true);
      const response = await fetch(item.downloadUrl, { method: "GET", cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const chunks = [];
      const reader = response.body.getReader();
      const contentLength = Number(response.headers.get("content-length") || 0);
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          const dlPct = itemPct + (received / contentLength) * (itemPctEnd - itemPct) * 0.55;
          setProgress(dlPct, "Downloading " + label + " — " + formatBytes(received) + " / " + formatBytes(contentLength));
          setWorkProgress("Downloading " + label, received, contentLength, {
            currentText: formatBytes(received),
            totalText: formatBytes(contentLength)
          });
        }
      }
      setActionButtonsDisabled(false);
      clearWorkProgress();
      const blob = new Blob(chunks, { type: "application/zip" });
      return new File([blob], label, { type: "application/zip", lastModified: Date.now() });
    });
  }
}
