"use strict";
function log(message, type = "info", meta) {
    const line = document.createElement("div");
    if (type === "error") {
      line.className = "error";
    }
    const timestamp = new Date().toLocaleTimeString();
    const text = typeof message === "string" ? message : (message && message.message) || String(message);
    line.textContent = "[" + timestamp + "] " + text;
    statusBox.append(line);
    statusBox.scrollTop = statusBox.scrollHeight;

    // Persist detailed logs for later debugging (kept bounded to avoid exhausting storage)
    try {
      const entry = {
        ts: Date.now(),
        time: new Date().toISOString(),
        level: String(type || "info"),
        message: text,
        meta: meta || undefined,
        url: (typeof location !== "undefined" && location.href) ? location.href : "",
        userAgent: (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent : "",
        deviceMemory: (typeof navigator !== "undefined" && typeof navigator.deviceMemory !== "undefined") ? navigator.deviceMemory : null,
        stack: (message && message.stack) ? String(message.stack) : (new Error().stack ? String(new Error().stack) : undefined)
      };
      appendErrorLog(entry);
    } catch (e) {
      // best-effort logging; swallow errors so logging never breaks app flow
    }
  }

// --- persistent error log helpers (localStorage-backed, size-limited) ---
const ERROR_LOG_KEY = "cbgames:errorLogs:v1";
const ERROR_LOG_MAX_BYTES = 512 * 1024; // ~512KB max stored JSON
const ERROR_LOG_MAX_ENTRIES = 2000;

function loadErrorLogs() {
  try {
    const raw = localStorage.getItem(ERROR_LOG_KEY) || "[]";
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveErrorLogs(arr) {
  try {
    let logs = Array.isArray(arr) ? arr.slice() : [];
    // trim by entries first
    while (logs.length > ERROR_LOG_MAX_ENTRIES) logs.shift();
    let json = JSON.stringify(logs);
    // trim by total bytes
    while (json.length > ERROR_LOG_MAX_BYTES && logs.length) {
      logs.shift();
      json = JSON.stringify(logs);
    }
    localStorage.setItem(ERROR_LOG_KEY, json);
  } catch (e) {
    // ignore storage errors
  }
}

function appendErrorLog(entry) {
  try {
    const logs = loadErrorLogs();
    logs.push(entry);
    saveErrorLogs(logs);
  } catch (e) {
    // ignore
  }
}

function clearErrorLogs() {
  try { localStorage.removeItem(ERROR_LOG_KEY); } catch (e) { }
}

function downloadErrorLogs() {
  try {
    const logs = loadErrorLogs();
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cbgames-error-logs-" + Date.now() + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    // ignore
  }
}

// Expose helpers for debugging/collection
try {
  if (typeof window !== "undefined") {
    window.cbgames = window.cbgames || {};
    window.cbgames.getErrorLogs = loadErrorLogs;
    window.cbgames.clearErrorLogs = clearErrorLogs;
    window.cbgames.downloadErrorLogs = downloadErrorLogs;
  }
} catch (e) {}

// Upload helper: try to relay logs to a server (Cloudflare Worker recommended)
async function uploadErrorLogsToEndpoint(endpointUrl, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const maxChunkSize = Number(opts.maxChunkSize) || 150 * 1024; // 150KB per POST by default
  const logs = loadErrorLogs();
  if (!logs || !logs.length) return { success: true, parts: 0 };

  // prepare chunks of entries so JSON stays small
  const parts = [];
  let cur = [];
  for (const entry of logs) {
    cur.push(entry);
    try {
      if (JSON.stringify(cur).length > maxChunkSize) {
        cur.pop();
        parts.push(cur.slice());
        cur = [entry];
      }
    } catch (e) {
      // on stringify error, skip this entry
      cur.pop();
      parts.push(cur.slice());
      cur = [];
    }
  }
  if (cur.length) parts.push(cur.slice());

  const results = [];
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i];
    const payload = JSON.stringify({ part: i + 1, total: parts.length, logs: chunk });
    const blob = new Blob([payload], { type: 'application/json' });

    // Prefer sendBeacon for reliability across navigations; fall back to fetch
    let ok = false;
    try {
      if (navigator && typeof navigator.sendBeacon === 'function') {
        ok = navigator.sendBeacon(endpointUrl, blob);
      }
    } catch (e) {
      ok = false;
    }

    if (!ok) {
      try {
        const resp = await fetch(endpointUrl, {
          method: 'POST',
          mode: 'cors',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        });
        ok = resp && resp.ok;
      } catch (e) {
        ok = false;
      }
    }
    results.push({ part: i + 1, ok });
    // small delay to avoid hammering network on flaky connections
    if (!ok) await new Promise((r) => setTimeout(r, 300));
  }

  return { success: results.every(r => r.ok), parts: parts.length, results };
}

try {
  if (typeof window !== "undefined") {
    window.cbgames = window.cbgames || {};
    window.cbgames.uploadErrorLogs = uploadErrorLogsToEndpoint;
  }
} catch (e) {}

// Install global handlers to capture uncaught errors and promise rejections
try {
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("error", function (ev) {
      try {
        const err = ev && (ev.error || ev.message) ? (ev.error || ev.message) : "Unknown error";
        log(err, "error", { filename: ev && ev.filename, lineno: ev && ev.lineno, colno: ev && ev.colno });
      } catch (e) {}
    });
    window.addEventListener("unhandledrejection", function (ev) {
      try {
        const reason = ev && ev.reason ? ev.reason : "Unhandled rejection";
        log(reason, "error", { unhandledRejection: true });
      } catch (e) {}
    });
  }
} catch (e) {}

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
    clearWorkProgressTree();
  }

// Module-level state for the file tree widget
var _wptLines = null;       // flat array of tree line objects
var _wptFileLineMap = null; // Map<filePath, lineIndex>

function _wptBuildTree(paths) {
    // Build a nested tree: each node = { children: {name: node}, fileIdx: number|null }
    var root = { children: Object.create(null), fileIdx: null };
    for (var i = 0; i < paths.length; i++) {
      var parts = String(paths[i] || "").split("/");
      var node = root;
      for (var d = 0; d < parts.length - 1; d++) {
        var p = parts[d];
        if (!node.children[p]) {
          node.children[p] = { children: Object.create(null), fileIdx: null };
        }
        node = node.children[p];
      }
      var fname = parts[parts.length - 1];
      if (!node.children[fname]) {
        node.children[fname] = { children: Object.create(null), fileIdx: i };
      }
    }

    var lines = [];
    var fileLineMap = new Map();

    function collectFileIndices(node, out) {
      if (node.fileIdx !== null) {
        out.push(node.fileIdx);
        return;
      }
      var ks = Object.keys(node.children);
      for (var ki = 0; ki < ks.length; ki++) {
        collectFileIndices(node.children[ks[ki]], out);
      }
    }

    function dfs(node, depth) {
      var keys = Object.keys(node.children).sort(function(a, b) {
        var aIsDir = node.children[a].fileIdx === null;
        var bIsDir = node.children[b].fileIdx === null;
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return a < b ? -1 : a > b ? 1 : 0;
      });
      for (var ki = 0; ki < keys.length; ki++) {
        var key = keys[ki];
        var child = node.children[key];
        var isDir = child.fileIdx === null;
        if (isDir) {
          var idxList = [];
          collectFileIndices(child, idxList);
          idxList.sort(function(a, b) { return a - b; });
          lines.push({ name: key, isDir: true, depth: depth, fileIndices: idxList });
          dfs(child, depth + 1);
        } else {
          var lineIdx = lines.length;
          var path = paths[child.fileIdx];
          lines.push({ name: key, isDir: false, depth: depth, fileIdx: child.fileIdx, path: path });
          fileLineMap.set(path, lineIdx);
        }
      }
    }

    dfs(root, 0);
    return { lines: lines, fileLineMap: fileLineMap };
  }

function setWorkProgressTree(completedCount, totalCount, currentPath, allPaths) {
    var el = document.getElementById("workProgressTree");
    if (!el) {
      return;
    }
    var safeTotal = Math.max(0, Number(totalCount) || 0);
    var safeDone = Math.max(0, Math.min(safeTotal, Number(completedCount) || 0));
    if (safeTotal === 0) {
      el.hidden = true;
      _wptLines = null;
      _wptFileLineMap = null;
      return;
    }

    // (Re)build tree if paths provided or not yet built
    if (allPaths && allPaths.length > 0) {
      var built = _wptBuildTree(allPaths);
      _wptLines = built.lines;
      _wptFileLineMap = built.fileLineMap;
    }

    if (!_wptLines || !_wptLines.length) {
      el.hidden = true;
      return;
    }

    el.hidden = false;

    var MAX_ROWS = 8;
    var lines = _wptLines;
    var fileLineMap = _wptFileLineMap;
    var safePath = String(currentPath || "").trim();

    // Find the flat-line index of the current file
    var focusIdx = 0;
    if (safePath && fileLineMap && fileLineMap.has(safePath)) {
      focusIdx = fileLineMap.get(safePath);
    } else if (safeDone >= safeTotal) {
      focusIdx = lines.length - 1;
    }

    // Sliding window: keep current file in view
    var winStart = Math.max(0, focusIdx - 2);
    var winEnd = Math.min(lines.length, winStart + MAX_ROWS);
    if (winEnd - winStart < MAX_ROWS) {
      winStart = Math.max(0, winEnd - MAX_ROWS);
    }

    var html = "";
    for (var li = winStart; li < winEnd; li++) {
      var line = lines[li];
      var state;
      if (line.isDir) {
        var doneInDir = 0;
        for (var fi = 0; fi < line.fileIndices.length; fi++) {
          if (line.fileIndices[fi] < safeDone) doneInDir++;
        }
        var hasActive = line.fileIndices.some(function(idx) {
          return idx === safeDone && safeDone < safeTotal;
        });
        state = doneInDir === line.fileIndices.length ? "done" :
                (doneInDir > 0 || hasActive) ? "active" : "pending";
      } else {
        state = line.fileIdx < safeDone ? "done" :
                line.path === safePath ? "active" : "pending";
      }

      var nameHtml = String(line.name)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      var countHtml = "";
      if (line.isDir) {
        var doneCount = 0;
        for (var fi2 = 0; fi2 < line.fileIndices.length; fi2++) {
          if (line.fileIndices[fi2] < safeDone) doneCount++;
        }
        countHtml = "<span class=\"wpt-count\">" + doneCount + "/" + line.fileIndices.length + "</span>";
      }

      html += "<div class=\"wpt-row wpt-" + state + "\" style=\"--depth:" + line.depth + "\">" +
        "<span class=\"wpt-icon wpt-icon-" + (line.isDir ? "dir" : "file") + "\"></span>" +
        "<span class=\"wpt-name\">" + nameHtml + (line.isDir ? "/" : "") + "</span>" +
        countHtml +
        "</div>";
    }

    el.innerHTML = html;
  }

function clearWorkProgressTree() {
    var el = document.getElementById("workProgressTree");
    if (el) {
      el.hidden = true;
      el.innerHTML = "";
    }
    _wptLines = null;
    _wptFileLineMap = null;
  }

