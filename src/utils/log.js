"use strict";
function log(message, type = "info") {
    const line = document.createElement("div");
    if (type === "error") {
      line.className = "error";
    }
    const timestamp = new Date().toLocaleTimeString();
    line.textContent = "[" + timestamp + "] " + message;
    statusBox.append(line);
    statusBox.scrollTop = statusBox.scrollHeight;
  }

function setUpdateScanStatus(text) {
    if (!updateScanStatus) {
      return;
    }
    const message = String(text || "").trim();
    updateScanStatus.textContent = "Update status: " + (message || "Not checked yet.");
  }

function setWorkProgress(label, current, total, displayValues) {
    if (!workProgress || !workProgressLabel || !workProgressCircle || !workProgressValue) {
      return;
    }
    const text = String(label || "Working...");
    const hasTotal = Number.isFinite(total) && total > 0;
    const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
    const safeTotal = hasTotal ? Math.max(1, total) : 0;
    if (hasTotal) {
      const pct = Math.max(0, Math.min(100, (safeCurrent / safeTotal) * 100));
      const hasDisplayValues = displayValues && typeof displayValues === "object";
      const currentText = hasDisplayValues && typeof displayValues.currentText === "string"
        ? displayValues.currentText
        : String(Math.min(safeCurrent, safeTotal));
      const totalText = hasDisplayValues && typeof displayValues.totalText === "string"
        ? displayValues.totalText
        : String(safeTotal);
      const etaText = hasDisplayValues && typeof displayValues.etaText === "string"
        ? displayValues.etaText
        : "";
      const etaSuffix = etaText ? " • " + etaText : "";
      workProgress.classList.remove("indeterminate");
      workProgressLabel.textContent = text + " (" + currentText + "/" + totalText + ")" + etaSuffix;
      workProgressCircle.style.setProperty("--progress-pct", pct.toFixed(1));
      workProgressValue.textContent = Math.round(pct) + "%";
      return;
    }
    workProgress.classList.add("indeterminate");
    workProgressLabel.textContent = text;
    workProgressCircle.style.setProperty("--progress-pct", "25");
    workProgressValue.textContent = "...";
  }

function clearWorkProgress() {
    if (!workProgress || !workProgressLabel || !workProgressCircle || !workProgressValue) {
      return;
    }
    workProgress.classList.remove("indeterminate");
    workProgressLabel.textContent = "Idle...";
    workProgressCircle.style.setProperty("--progress-pct", "0");
    workProgressValue.textContent = "0%";
  }
