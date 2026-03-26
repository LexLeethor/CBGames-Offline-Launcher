"use strict";
function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes === 0) {
      return "0 B";
    }
    const units = ["B", "KB", "MB", "GB", "TB"]; // if anyone has petabytes -_-
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const scaled = bytes / Math.pow(1024, exponent);
    return scaled.toFixed(scaled >= 100 || exponent === 0 ? 0 : 1) + " " + units[exponent];
  }

function formatEtaSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return "";
    }
    const rounded = Math.max(0, Math.round(seconds));
    if (rounded <= 1) {
      return "ETA <1s";
    }
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;
    if (hours > 0) {
      return "ETA " + hours + "h " + String(minutes).padStart(2, "0") + "m";
    }
    if (minutes > 0) {
      return "ETA " + minutes + "m " + String(secs).padStart(2, "0") + "s";
    }
    return "ETA " + secs + "s";
  }

function estimateEtaSeconds(startMs, current, total) {
    if (!Number.isFinite(startMs) || !Number.isFinite(current) || !Number.isFinite(total)) {
      return null;
    }
    if (total <= 0 || current <= 0 || current > total) {
      return null;
    }
    const elapsedSeconds = (performance.now() - startMs) / 1000;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      return null;
    }
    const rate = current / elapsedSeconds;
    if (!Number.isFinite(rate) || rate <= 0) {
      return null;
    }
    return Math.max(0, (total - current) / rate);
  }

function formatDate(ts) {
    if (!ts) {
      return "unknown";
    }
    return new Date(ts).toLocaleString();
  }
