"use strict";
function normalizeNetworkHostUrl(rawValue) {
    let value = String(rawValue || "").trim();
    if (!value) {
      return "";
    }
    if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(value)) {
      value = "http://" + value;
    }
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      parsed.hash = "";
      parsed.search = "";
      parsed.pathname = "";
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  }

function setNetworkTransferStatus(message, tone = "info") {
    if (!networkTransferStatus) {
      return;
    }
    const text = String(message || "").trim();
    networkTransferStatus.textContent = text || "Enter a host URL, then click Load Shared.";
    networkTransferStatus.classList.toggle("is-error", tone === "error");
    networkTransferStatus.classList.toggle("is-success", tone === "success");
  }

function getNetworkTransferSelectedItems() {
    const items = Array.isArray(state.networkTransfer.items) ? state.networkTransfer.items : [];
    return items.filter((item) => item && item.selected !== false);
  }

function syncNetworkImportButtonState() {
    if (!networkImportSelectedButton) {
      return;
    }
    if (state.actionInProgress) {
      networkImportSelectedButton.disabled = true;
      return;
    }
    networkImportSelectedButton.disabled = getNetworkTransferSelectedItems().length === 0;
  }

function renderNetworkTransferList() {
    if (!networkTransferList) {
      return;
    }
    networkTransferList.innerHTML = "";
    const items = Array.isArray(state.networkTransfer.items) ? state.networkTransfer.items : [];
    if (!items.length) {
      networkTransferList.hidden = true;
      syncNetworkImportButtonState();
      return;
    }
    networkTransferList.hidden = false;
    for (const item of items) {
      const row = document.createElement("label");
      row.className = "network-transfer-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.selected !== false;
      checkbox.disabled = state.actionInProgress;
      checkbox.setAttribute("data-network-item-id", item.id);

      const meta = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = item.name;
      const details = document.createElement("small");
      details.textContent =
        (item.type === "bundle" ? "Bundle ZIP" : "Game ZIP") +
        " • " +
        formatBytes(item.size || 0);
      meta.append(name, details);

      row.append(checkbox, meta);
      networkTransferList.append(row);
    }
    syncNetworkImportButtonState();
  }

async function loadNetworkTransferManifest() {
    if (!networkHostUrlInput) {
      return;
    }
    const normalizedHost = normalizeNetworkHostUrl(
      networkHostUrlInput.value || state.networkTransfer.hostUrl || NETWORK_TRANSFER_DEFAULT_HOST_URL
    );
    if (!normalizedHost) {
      setNetworkTransferStatus("Enter a valid host URL (example: http://192.168.1.10:8941).", "error");
      return;
    }

    networkHostUrlInput.value = normalizedHost;
    state.networkTransfer.hostUrl = normalizedHost;
    setNetworkTransferStatus("Loading shared files from " + normalizedHost + "...", "info");
    setWorkProgress("Loading network host manifest", 0, 0);

    try {
      const response = await fetch(normalizedHost + "/api/manifest", {
        method: "GET",
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error("Host returned HTTP " + response.status + ".");
      }
      const payload = await response.json();
      const rawItems = Array.isArray(payload && payload.items) ? payload.items : [];
      const knownIds = new Set();
      const mapped = [];
      for (let i = 0; i < rawItems.length; i += 1) {
        const rawItem = rawItems[i];
        if (!rawItem || typeof rawItem !== "object") {
          continue;
        }
        const fallbackId = "shared-" + (i + 1);
        const sourceId = String(rawItem.id || "").trim() || fallbackId;
        let id = sourceId;
        let dedupe = 1;
        while (knownIds.has(id)) {
          dedupe += 1;
          id = sourceId + "-" + dedupe;
        }
        knownIds.add(id);

        const rawName = String(rawItem.name || "").trim();
        const name = rawName || ("shared-" + (i + 1) + ".zip");
        const rawType = String(rawItem.type || "").toLowerCase();
        const type = rawType === "bundle" ? "bundle" : "zip";
        const rawSize = Number(rawItem.size);
        const size = Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : 0;

        let downloadUrl = "";
        try {
          const rawDownload = String(rawItem.downloadUrl || "").trim();
          if (rawDownload) {
            downloadUrl = String(new URL(rawDownload, normalizedHost));
          }
        } catch {
          downloadUrl = "";
        }
        if (!downloadUrl) {
          downloadUrl = normalizedHost + "/download/" + encodeURIComponent(id);
        }

        mapped.push({
          id,
          name,
          type,
          size,
          downloadUrl,
          selected: true
        });
      }

      state.networkTransfer.items = mapped;
      renderNetworkTransferList();

      if (!mapped.length) {
        setNetworkTransferStatus("Connected, but no shared files are currently available.", "info");
        log("Network host connected. No shared files were returned.");
      } else {
        setNetworkTransferStatus("Loaded " + mapped.length + " shared file(s).", "success");
        log("Loaded " + mapped.length + " shared file(s) from network host.");
      }
    } catch (error) {
      console.error(error);
      state.networkTransfer.items = [];
      renderNetworkTransferList();
      setNetworkTransferStatus("Could not load shared files: " + (error.message || String(error)), "error");
      log("Network manifest load failed: " + (error.message || String(error)), "error");
    } finally {
      clearWorkProgress();
    }
  }

async function getNetworkDownloadHeadInfo(url) {
    const response = await fetch(url, {
      method: "HEAD",
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error("HEAD failed with HTTP " + response.status + ".");
    }
    return {
      contentLength: Number(response.headers.get("content-length")) || 0
    };
  }

async function downloadNetworkTransferItem(item, current, total) {
    const name = String(item && item.name ? item.name : "shared-" + current + ".zip");
    let expectedTotal = Number(item && item.size) || 0;
    try {
      const head = await getNetworkDownloadHeadInfo(item.downloadUrl);
      expectedTotal = Number(head.contentLength) || expectedTotal;
    } catch {
      // Some hosts or proxies may not allow HEAD; fall back to GET headers/manifest size.
    }

    const progressLabel = "Downloading " + name;
    if (expectedTotal > 0) {
      setWorkProgress(
        progressLabel,
        0,
        expectedTotal,
        { currentText: formatBytes(0), totalText: formatBytes(expectedTotal) }
      );
    } else {
      setWorkProgress(progressLabel, 0, 0);
    }

    const response = await fetch(item.downloadUrl, {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(name + " failed with HTTP " + response.status + ".");
    }

    const contentLength = Number(response.headers.get("content-length")) || 0;
    const totalBytes = contentLength || expectedTotal;
    const reader = response.body && typeof response.body.getReader === "function"
      ? response.body.getReader()
      : null;
    const downloadStart = performance.now();

    if (!reader) {
      const blob = await response.blob();
      const byteLength = Number(blob.size) || 0;
      if (byteLength > 0) {
        setWorkProgress(
          progressLabel,
          byteLength,
          byteLength,
          { currentText: formatBytes(byteLength), totalText: formatBytes(byteLength) }
        );
      } else {
        setWorkProgress(progressLabel, 1, 1);
      }
      return new File([blob], name, {
        type: blob.type || "application/zip",
        lastModified: Date.now()
      });
    }

    let loaded = 0;
    let lastReported = 0;
    const chunks = [];
    while (true) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      const chunk = part.value;
      if (!chunk) {
        continue;
      }
      chunks.push(chunk);
      loaded += chunk.byteLength;

      if (loaded - lastReported >= 131072 || (totalBytes > 0 && loaded >= totalBytes)) {
        if (totalBytes > 0) {
          const etaText = formatEtaSeconds(estimateEtaSeconds(downloadStart, loaded, totalBytes));
          setWorkProgress(
            progressLabel,
            loaded,
            totalBytes,
            { currentText: formatBytes(loaded), totalText: formatBytes(totalBytes), etaText }
          );
        } else {
          setWorkProgress(progressLabel + " (" + formatBytes(loaded) + ")", 0, 0);
        }
        lastReported = loaded;
      }
    }

    if (totalBytes > 0) {
      const etaText = formatEtaSeconds(estimateEtaSeconds(downloadStart, loaded, totalBytes));
      setWorkProgress(
        progressLabel,
        loaded,
        totalBytes,
        { currentText: formatBytes(loaded), totalText: formatBytes(totalBytes), etaText }
      );
    } else if (loaded > 0) {
      setWorkProgress(
        progressLabel,
        loaded,
        loaded,
        { currentText: formatBytes(loaded), totalText: formatBytes(loaded) }
      );
    } else {
      setWorkProgress(progressLabel, 1, 1);
    }

    const blob = new Blob(chunks, {
      type: response.headers.get("content-type") || "application/zip"
    });
    return new File([blob], name, {
      type: blob.type || "application/zip",
      lastModified: Date.now()
    });
  }

async function importSelectedNetworkTransfers() {
    const selectedItems = getNetworkTransferSelectedItems();
    if (!selectedItems.length) {
      setNetworkTransferStatus("Select at least one shared file first.", "error");
      return;
    }

    let processedCount = 0;
    let failedDownloads = 0;
    for (let index = 0; index < selectedItems.length; index += 1) {
      const item = selectedItems[index];
      const label = String(item && item.name ? item.name : "shared-" + (index + 1) + ".zip");
      try {
        setActionButtonsDisabled(true);
        const downloaded = await downloadNetworkTransferItem(item, index + 1, selectedItems.length);
        setActionButtonsDisabled(false);
        clearWorkProgress();
        if (item.type === "bundle") {
          await importBundleFile(downloaded);
        } else {
          await importZipFile(downloaded);
        }
        processedCount += 1;
      } catch (error) {
        failedDownloads += 1;
        console.error(error);
        log("Network transfer failed for " + label + ": " + (error.message || String(error)), "error");
      } finally {
        setActionButtonsDisabled(false);
        clearWorkProgress();
      }
    }

    if (processedCount > 0 && failedDownloads === 0) {
      setNetworkTransferStatus(
        "Processed " + processedCount + " file(s). Check the Activity Log for each import result.",
        "success"
      );
      return;
    }
    if (processedCount > 0) {
      setNetworkTransferStatus(
        "Processed " + processedCount + " file(s), but " + failedDownloads + " download(s) failed.",
        "error"
      );
      return;
    }
    setNetworkTransferStatus("No selected files could be downloaded from the host.", "error");
  }
