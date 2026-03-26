"use strict";
function sanitizeNetworkBundleName(input, fallback) {
    const base = String(input || "").trim() || fallback;
    const cleaned = base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return (cleaned || fallback) + ".zip";
  }

async function buildNetworkUploadBundle() {
    const games = await getAllGames();
    if (!games.length) {
      throw new Error("No saved games are available to upload.");
    }
    const suggestedName = "cbgames-upload-all-" + new Date().toISOString().slice(0, 10);

    const exportStart = performance.now();
    const bundleBlob = await exportGamesBundle(games, (current, total) => {
      const etaText = formatEtaSeconds(estimateEtaSeconds(exportStart, current, total));
      setWorkProgress(
        "Preparing upload bundle",
        current,
        total,
        { currentText: String(current), totalText: String(total), etaText }
      );
    });
    return {
      gameCount: games.length,
      fileName: sanitizeNetworkBundleName(suggestedName, "cbgames-upload"),
      bundleBlob
    };
  }

function uploadBlobWithProgress(url, blob, headers, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);
      if (headers && typeof headers === "object") {
        for (const [key, value] of Object.entries(headers)) {
          if (typeof value === "string") {
            xhr.setRequestHeader(key, value);
          }
        }
      }
      xhr.responseType = "text";
      if (xhr.upload && typeof xhr.upload.addEventListener === "function") {
        xhr.upload.addEventListener("progress", (event) => {
          if (typeof onProgress === "function") {
            const loaded = Number(event.loaded) || 0;
            const total = event.lengthComputable ? Number(event.total) || 0 : 0;
            onProgress(loaded, total);
          }
        });
      }
      xhr.addEventListener("load", () => {
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          text: xhr.responseText || ""
        });
      });
      xhr.addEventListener("error", () => {
        reject(new Error("Upload failed due to a network error."));
      });
      xhr.send(blob);
    });
  }

async function uploadNetworkBundleWithOtc() {
    if (!networkHostUrlInput || !networkUploadCodeInput) {
      return;
    }
    const normalizedHost = normalizeNetworkHostUrl(
      networkHostUrlInput.value || state.networkTransfer.hostUrl || NETWORK_TRANSFER_DEFAULT_HOST_URL
    );
    if (!normalizedHost) {
      setNetworkTransferStatus("Enter a valid host URL before uploading.", "error");
      return;
    }
    const otc = String(networkUploadCodeInput.value || "").trim().toUpperCase();
    if (!otc) {
      setNetworkTransferStatus("Enter the one-time code from the host terminal.", "error");
      return;
    }
    state.networkTransfer.hostUrl = normalizedHost;
    networkHostUrlInput.value = normalizedHost;

    setActionButtonsDisabled(true);
    try {
      const uploadBundle = await buildNetworkUploadBundle();
      const uploadStart = performance.now();
      if (uploadBundle.bundleBlob && typeof uploadBundle.bundleBlob.size === "number" && uploadBundle.bundleBlob.size > 0) {
        setWorkProgress(
          "Uploading bundle to host",
          0,
          uploadBundle.bundleBlob.size,
          { currentText: formatBytes(0), totalText: formatBytes(uploadBundle.bundleBlob.size) }
        );
      } else {
        setWorkProgress("Uploading bundle to host", 0, 0);
      }
      const uploadUrl =
        normalizedHost +
        "/api/client-upload?otc=" + encodeURIComponent(otc) +
        "&name=" + encodeURIComponent(uploadBundle.fileName) +
        "&type=bundle&shared=1";
      const response = await uploadBlobWithProgress(
        uploadUrl,
        uploadBundle.bundleBlob,
        {
          "Content-Type": "application/zip"
        },
        (loaded, total) => {
          const etaText = total > 0
            ? formatEtaSeconds(estimateEtaSeconds(uploadStart, loaded, total))
            : "";
          if (total > 0) {
            setWorkProgress(
              "Uploading bundle to host",
              loaded,
              total,
              { currentText: formatBytes(loaded), totalText: formatBytes(total), etaText }
            );
          } else {
            setWorkProgress("Uploading bundle to host (" + formatBytes(loaded) + ")", 0, 0);
          }
        }
      );
      let payload = null;
      if (response.text) {
        try {
          payload = JSON.parse(response.text);
        } catch {
          payload = null;
        }
      }
      if (!response.ok) {
        const message = payload && payload.error
          ? payload.error
          : "Host upload failed with HTTP " + response.status + ".";
        throw new Error(message);
      }

      setNetworkTransferStatus(
        "Uploaded bundle to host (" + uploadBundle.gameCount + " game(s)). Load shared list to pull it.",
        "success"
      );
      log("Uploaded bundle to network host with one-time code.");
      networkUploadCodeInput.value = "";
    } catch (error) {
      console.error(error);
      setNetworkTransferStatus("Host upload failed: " + (error.message || String(error)), "error");
      log("Network host upload failed: " + (error.message || String(error)), "error");
    } finally {
      setActionButtonsDisabled(false);
      clearWorkProgress();
    }
  }
