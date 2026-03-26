"use strict";
function rewriteCssTextForBase(cssText, baseHref) {
    if (typeof cssText !== "string" || !cssText) {
      return cssText;
    }
    const resolvedBase = normalizeResolverBase(baseHref);
    return cssText.replace(/url\(\s*(['"]?)([^"')]+)\1\s*\)/gi, (full, quote, urlPath) => {
      const raw = String(urlPath || "").trim();
      if (!raw) {
        return full;
      }
      const lower = raw.toLowerCase();
      if (
        lower.startsWith("data:") ||
        lower.startsWith("blob:") ||
        lower.startsWith("about:")
      ) {
        return full;
      }
      const mapped = requestToObjectUrl(raw, resolvedBase);
      if (!mapped) {
        return full;
      }
      const wrapped = quote || "\"";
      return "url(" + wrapped + mapped + wrapped + ")";
    });
  }

function rewriteCssText(cssText, cssPath) {
    const baseHref = toVirtualUrl(cssPath);
    return rewriteCssTextForBase(cssText, baseHref);
  }

function bytesToBase64(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      return "";
    }
    const chunkSize = 0x8000;
    let out = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const slice = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
      out += String.fromCharCode.apply(null, slice);
    }
    return btoa(out);
  }

function textToBase64(text) {
    return btoa(unescape(encodeURIComponent(String(text || ""))));
  }

function base64ToBytes(base64Text) {
    const base64 = String(base64Text || "");
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }

function encodeUtf8(text) {
    return new TextEncoder().encode(String(text || ""));
  }

function decodeUtf8(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
  }

function concatUint8Arrays(chunks) {
    let totalLength = 0;
    for (const chunk of chunks) {
      totalLength += chunk.length;
    }
    const out = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

function extensionFromMime(mime) {
    const type = String(mime || "").toLowerCase();
    if (type === "image/png") return ".png";
    if (type === "image/jpeg") return ".jpg";
    if (type === "image/webp") return ".webp";
    if (type === "image/gif") return ".gif";
    return "";
  }

function parseDataUrlToBytes(dataUrl) {
    const text = String(dataUrl || "");
    const match = text.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(?:;(base64))?,([\s\S]*)$/i);
    if (!match) {
      return null;
    }
    const mime = (match[1] || "application/octet-stream").toLowerCase();
    const isBase64 = Boolean(match[2]);
    const payload = match[3] || "";
    if (isBase64) {
      return {
        mime,
        bytes: base64ToBytes(payload)
      };
    }
    const decoded = decodeURIComponent(payload);
    const out = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) {
      out[i] = decoded.charCodeAt(i);
    }
    return { mime, bytes: out };
  }

function findReferencedWasmPath(scriptText, scriptPath, recordsByPath) {
    if (typeof scriptText !== "string" || !scriptText) {
      return null;
    }
    const baseHref = toVirtualUrl(scriptPath);
    const candidates = [];
    const refMatches = scriptText.matchAll(/(["'])([^"'\\]*?\.wasm(?:\.[^"'\\\/?#]+)?)\1/g);
    for (const match of refMatches) {
      const rawRef = match[2];
      if (rawRef) {
        candidates.push(rawRef);
      }
    }
    candidates.push(scriptPath.replace(/\.wasm\.js$/i, ".wasm.wasm"));
    candidates.push(scriptPath.replace(/\.js$/i, ".wasm"));
    candidates.push(scriptPath.replace(/\.js$/i, ".wasm.wasm"));

    for (const rawRef of candidates) {
      const resolvedFromBase = resolveToPath(rawRef, baseHref);
      if (resolvedFromBase && recordsByPath.has(resolvedFromBase)) {
        return { rawRef, path: resolvedFromBase };
      }
      const resolvedFromRoot = resolveToPath(rawRef, VFS_ORIGIN);
      if (resolvedFromRoot && recordsByPath.has(resolvedFromRoot)) {
        return { rawRef, path: resolvedFromRoot };
      }
      if (resolvedFromRoot) {
        const basePath = resolveToPath(baseHref, VFS_ORIGIN);
        let probeDir = basePath ? dirnamePath(basePath) : "";
        while (probeDir) {
          const candidate = normalizePath(probeDir + "/" + resolvedFromRoot);
          if (recordsByPath.has(candidate)) {
            return { rawRef, path: candidate };
          }
          probeDir = dirnamePath(probeDir);
        }
      }
    }
    return null;
  }

function replaceFirstWasmRef(scriptText, rawRef, dataUrl) {
    if (typeof scriptText !== "string") {
      return scriptText;
    }
    const replacement = JSON.stringify(dataUrl);
    const doubleQuoted = JSON.stringify(rawRef);
    if (scriptText.includes(doubleQuoted)) {
      return scriptText.replace(doubleQuoted, replacement);
    }
    const singleQuoted = "'" + String(rawRef).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
    if (scriptText.includes(singleQuoted)) {
      return scriptText.replace(singleQuoted, replacement);
    }
    return scriptText;
  }

function shouldInlineWasmForScript(scriptPath, scriptText) {
    const path = String(scriptPath || "");
    const text = String(scriptText || "");
    return /(?:^|\/)ammo\.wasm\.js$/i.test(path) || /ammo\.wasm\.wasm/i.test(text);
  }

async function patchEmscriptenWasmScriptText(scriptText, scriptPath, recordsByPath, dataUrlCache) {
    if (typeof scriptText !== "string" || !scriptText || !scriptPath) {
      return scriptText;
    }
    if (!shouldInlineWasmForScript(scriptPath, scriptText)) {
      return scriptText;
    }
    const wasmRef = findReferencedWasmPath(scriptText, scriptPath, recordsByPath);
    if (!wasmRef) {
      return scriptText;
    }

    const wasmPath = wasmRef.path;
    const wasmRecord = recordsByPath.get(wasmPath);
    if (!wasmRecord) {
      return scriptText;
    }

    let wasmDataUrl = dataUrlCache.get(wasmPath) || "";
    if (!wasmDataUrl) {
      const wasmBytes = new Uint8Array(await wasmRecord.blob.arrayBuffer());
      wasmDataUrl = "data:application/wasm;base64," + bytesToBase64(wasmBytes);
      dataUrlCache.set(wasmPath, wasmDataUrl);
    }

    const wasmRefRaw = String(wasmRef.rawRef || "");
    const marker = "if(!F(O=" + JSON.stringify(wasmRefRaw) + ")){var L=O;O=n.locateFile?n.locateFile(L,u):u+L}";
    const forcedWasmAssign = "O=" + JSON.stringify(wasmDataUrl) + ";";
    if (scriptText.includes(marker)) {
      return scriptText.replace(marker, forcedWasmAssign);
    }
    return replaceFirstWasmRef(scriptText, wasmRefRaw, wasmDataUrl);
  }

async function buildEmscriptenInlineDataUrl(scriptPath, recordsByPath, dataUrlCache) {
    if (!scriptPath) {
      return null;
    }
    const scriptRecord = recordsByPath.get(scriptPath);
    if (!scriptRecord) {
      return null;
    }

    const scriptText = await scriptRecord.blob.text();
    if (!shouldInlineWasmForScript(scriptPath, scriptText)) {
      return null;
    }
    const wasmRef = findReferencedWasmPath(scriptText, scriptPath, recordsByPath);
    if (!wasmRef) {
      return null;
    }

    const wasmPath = wasmRef.path;
    const wasmRecord = recordsByPath.get(wasmPath);
    if (!wasmRecord) {
      return null;
    }

    const cacheKey = "__ems_inline__:" + scriptPath + ":" + wasmPath;
    if (dataUrlCache.has(cacheKey)) {
      return dataUrlCache.get(cacheKey);
    }

    let wasmDataUrl = dataUrlCache.get(wasmPath) || "";
    if (!wasmDataUrl) {
      const wasmBytes = new Uint8Array(await wasmRecord.blob.arrayBuffer());
      wasmDataUrl = "data:application/wasm;base64," + bytesToBase64(wasmBytes);
      dataUrlCache.set(wasmPath, wasmDataUrl);
    }

    const wasmRefRaw = String(wasmRef.rawRef || "");
    const patchedScriptText = await patchEmscriptenWasmScriptText(
      scriptText,
      scriptPath,
      recordsByPath,
      dataUrlCache
    );

    const wasmBasename = String(wasmPath).split("/").pop() || "";
    const loaderKeys = [wasmRefRaw, wasmBasename].filter((value, index, arr) => value && arr.indexOf(value) === index);
    const prelude =
      "(function(){var __loaderWasmUrl=" + JSON.stringify(wasmDataUrl) + ";" +
      "var __loaderWasmKeys=" + JSON.stringify(loaderKeys) + ";" +
      "function __isLoaderWasmPath(path){if(typeof path!=='string'){return false;}for(var i=0;i<__loaderWasmKeys.length;i++){if(path===__loaderWasmKeys[i]){return true;}}return false;}" +
      "self.Module=self.Module||{};" +
      "var __prevLocate=self.Module.locateFile;" +
      "self.Module.locateFile=function(path,prefix){" +
      "if(__isLoaderWasmPath(path)){return __loaderWasmUrl;}" +
      "if(typeof __prevLocate==='function'){return __prevLocate(path,prefix);}" +
      "return (prefix||'')+path;};" +
      "if(typeof self.fetch==='function'){var __prevFetch=self.fetch.bind(self);self.fetch=function(input,init){if(__isLoaderWasmPath(input)){input=__loaderWasmUrl;}return __prevFetch(input,init);};}" +
      "if(typeof XMLHttpRequest==='function'){var __prevOpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){if(__isLoaderWasmPath(url)){url=__loaderWasmUrl;}return __prevOpen.apply(this,[method,url].concat(Array.prototype.slice.call(arguments,2)));};}" +
      "})();\n";
    const dataUrl = "data:application/javascript;base64," + textToBase64(prelude + patchedScriptText);
    dataUrlCache.set(cacheKey, dataUrl);
    return dataUrl;
  }

async function buildInlineScriptDataUrl(scriptPath, recordsByPath, dataUrlCache) {
    if (!scriptPath) {
      return null;
    }
    const cacheKey = "__js_inline__:" + scriptPath;
    if (dataUrlCache.has(cacheKey)) {
      return dataUrlCache.get(cacheKey);
    }
    const scriptRecord = recordsByPath.get(scriptPath);
    if (!scriptRecord) {
      return null;
    }
    const scriptText = await scriptRecord.blob.text();
    const dataUrl = "data:application/javascript;base64," + textToBase64(scriptText);
    dataUrlCache.set(cacheKey, dataUrl);
    return dataUrl;
  }

async function rewriteImportScriptsText(scriptText, scriptPath, recordsByPath, dataUrlCache) {
    if (typeof scriptText !== "string" || !scriptText) {
      return scriptText;
    }
    const baseHref = toVirtualUrl(scriptPath);
    const matches = Array.from(scriptText.matchAll(/importScripts\(([^)]*)\)/g));
    if (!matches.length) {
      return scriptText;
    }

    let rewritten = "";
    let cursor = 0;
    for (const match of matches) {
      const full = match[0];
      const argsText = match[1];
      const start = match.index || 0;
      const end = start + full.length;
      rewritten += scriptText.slice(cursor, start);
      if (!argsText || typeof argsText !== "string") {
        rewritten += full;
        cursor = end;
        continue;
      }

      let argsOut = "";
      let argCursor = 0;
      const argMatches = Array.from(argsText.matchAll(/(['"])([^"'\\]+)\1/g));
      for (const argMatch of argMatches) {
        const segment = argMatch[0];
        const quote = argMatch[1];
        const rawPath = argMatch[2];
        const segStart = argMatch.index || 0;
        const segEnd = segStart + segment.length;
        argsOut += argsText.slice(argCursor, segStart);

        const resolvedPath = resolveToPath(rawPath, baseHref);
        let mapped = requestToObjectUrl(rawPath, baseHref);
        if (resolvedPath && /\.(?:js|mjs|cjs)$/i.test(resolvedPath)) {
          const emscriptenInlineUrl = await buildEmscriptenInlineDataUrl(
            resolvedPath,
            recordsByPath,
            dataUrlCache
          );
          if (emscriptenInlineUrl) {
            mapped = emscriptenInlineUrl;
          } else {
            const inlineScriptUrl = await buildInlineScriptDataUrl(
              resolvedPath,
              recordsByPath,
              dataUrlCache
            );
            if (inlineScriptUrl) {
              mapped = inlineScriptUrl;
            }
          }
        }

        if (!mapped) {
          argsOut += segment;
        } else {
          argsOut += quote + mapped + quote;
        }
        argCursor = segEnd;
      }
      argsOut += argsText.slice(argCursor);
      rewritten += "importScripts(" + argsOut + ")";
      cursor = end;
    }
    rewritten += scriptText.slice(cursor);
    return rewritten;
  }

function isUnityWebConfigObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    if (typeof value.dataUrl !== "string") {
      return false;
    }
    return (
      typeof value.asmCodeUrl === "string" ||
      typeof value.wasmCodeUrl === "string" ||
      typeof value.asmFrameworkUrl === "string" ||
      typeof value.frameworkUrl === "string"
    );
  }

function rewriteUnityWebConfigText(jsonText, path) {
    if (!UNITY_GPU_SAFE_MODE || typeof jsonText !== "string" || !/\.json$/i.test(path)) {
      return { text: jsonText, changed: false };
    }

    let config;
    try {
      config = JSON.parse(jsonText);
    } catch {
      return { text: jsonText, changed: false };
    }

    if (!isUnityWebConfigObject(config)) {
      return { text: jsonText, changed: false };
    }

    let changed = false;
    if (UNITY_FORCE_WEBGL1) {
      const currentApis = Array.isArray(config.graphicsAPI)
        ? config.graphicsAPI.map((api) => String(api))
        : [];
      const supportsWebGL1 = currentApis.some((api) => api === "WebGL 1.0");
      if (supportsWebGL1 || !currentApis.length) {
        const nextApis = ["WebGL 1.0"];
        if (
          currentApis.length !== nextApis.length ||
          currentApis.some((api, index) => api !== nextApis[index])
        ) {
          config.graphicsAPI = nextApis;
          changed = true;
        }
      }
    }

    const nextContextAttrs = {
      ...(config.webglContextAttributes && typeof config.webglContextAttributes === "object"
        ? config.webglContextAttributes
        : {})
    };
    const requiredAttrs = {
      antialias: false,
      alpha: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      desynchronized: true,
      powerPreference: "low-power"
    };
    for (const [key, value] of Object.entries(requiredAttrs)) {
      if (nextContextAttrs[key] !== value) {
        nextContextAttrs[key] = value;
        changed = true;
      }
    }
    config.webglContextAttributes = nextContextAttrs;

    const forcedDpr = Number(UNITY_CLAMP_DEVICE_PIXEL_RATIO);
    if (forcedDpr > 0 && Number(config.devicePixelRatio) !== forcedDpr) {
      config.devicePixelRatio = forcedDpr;
      changed = true;
    }

    if (!changed) {
      return { text: jsonText, changed: false };
    }

    return {
      text: JSON.stringify(config),
      changed: true
    };
  }

async function buildObjectUrlCacheFromRecords(records, hostWindow) {
    let host = window;
    try {
      if (
        hostWindow &&
        hostWindow.URL &&
        typeof hostWindow.URL.createObjectURL === "function" &&
        typeof hostWindow.URL.revokeObjectURL === "function"
      ) {
        host = hostWindow;
      }
    } catch {
      host = window;
    }
    clearObjectUrls();
    state.objectUrlHost = host;
    const recordsByPath = new Map(records.map((record) => [record.path, record]));
    const dataUrlCache = new Map();

    async function maybeDecompressBrotli(record) {
      if (!/\.br$/i.test(record.path)) {
        return null;
      }
      try {
        let buffer;
        if (typeof DecompressionStream === "function") {
          try {
            const stream = record.blob.stream().pipeThrough(new DecompressionStream("brotli"));
            buffer = await new Response(stream).arrayBuffer();
          } catch (error) {
            console.warn("Native Brotli decompression failed, falling back to JS decoder.", error);
          }
        }
        if (!buffer && typeof window.BrotliDecode === "function") {
          const raw = new Uint8Array(await record.blob.arrayBuffer());
          const decoded = window.BrotliDecode(raw);
          buffer = (decoded instanceof Uint8Array ? decoded : new Uint8Array(decoded)).buffer;
        }
        if (!buffer) {
          log("Brotli (.br) assets require DecompressionStream or BrotliDecode.", "error");
          return null;
        }
        const decodedPath = record.path.replace(/\.br$/i, "");

        if (/\.(?:js|mjs|cjs)$/i.test(decodedPath)) {
          const originalText = new TextDecoder().decode(new Uint8Array(buffer));
          const emsPatchedText = await patchEmscriptenWasmScriptText(
            originalText,
            decodedPath,
            recordsByPath,
            dataUrlCache
          );
          let rewrittenText = await rewriteImportScriptsText(
            emsPatchedText,
            decodedPath,
            recordsByPath,
            dataUrlCache
          );
          if (rewrittenText && rewrittenText.indexOf("document.baseURI||self.location.href") !== -1) {
            const baseDir = (() => {
              const dir = dirnamePath(decodedPath);
              if (!dir) {
                return VFS_ORIGIN;
              }
              const encoded = dir.split("/").map(encodeURIComponent).join("/");
              return VFS_ORIGIN + encoded + "/";
            })();
            const prefix =
              "(function(){try{if(typeof self!=='undefined'){self.__launcherBaseHref=" +
              JSON.stringify(baseDir) +
              ";}}catch(_e){}})();";
            rewrittenText = prefix + rewrittenText.replaceAll(
              "document.baseURI||self.location.href",
              "(self.__launcherBaseHref||document.baseURI||self.location.href)"
            );
          }
          const jsBlob = new Blob([rewrittenText], { type: "application/javascript" });
          return { decodedPath, blob: jsBlob };
        }

        if (/\.css$/i.test(decodedPath)) {
          const originalText = new TextDecoder().decode(new Uint8Array(buffer));
          const rewrittenText = rewriteCssText(originalText, decodedPath);
          const cssBlob = new Blob([rewrittenText], { type: "text/css" });
          return { decodedPath, blob: cssBlob };
        }

        if (/\.json$/i.test(decodedPath)) {
          const originalText = new TextDecoder().decode(new Uint8Array(buffer));
          const rewrite = rewriteUnityWebConfigText(originalText, decodedPath);
          const jsonBlob = new Blob([rewrite.text], { type: "application/json" });
          return { decodedPath, blob: jsonBlob };
        }

        const mime = mimeFromPath(decodedPath);
        return { decodedPath, blob: new Blob([buffer], { type: mime }) };
      } catch (error) {
        console.error(error);
        log("Failed to decompress " + record.path, "error");
        return null;
      }
    }

    for (const record of records) {
      if (/\.br$/i.test(record.path)) {
        const decompressed = await maybeDecompressBrotli(record);
        if (decompressed) {
          state.objectUrls.set(record.path, host.URL.createObjectURL(decompressed.blob));
          state.objectUrls.set(decompressed.decodedPath, host.URL.createObjectURL(decompressed.blob));
          continue;
        }
      }
      state.objectUrls.set(record.path, host.URL.createObjectURL(record.blob));
    }

    let rewrittenCssCount = 0;
    let rewrittenUnityConfigCount = 0;
    for (const record of records) {
      try {
        let rewrittenText = "";
        let rewrittenMime = "";

        if (/\.css$/i.test(record.path)) {
          const originalText = await record.blob.text();
          rewrittenText = rewriteCssText(originalText, record.path);
          if (rewrittenText === originalText) {
            continue;
          }
          rewrittenMime = "text/css";
          rewrittenCssCount += 1;
        } else if (/\.json$/i.test(record.path)) {
          const originalText = await record.blob.text();
          const rewrite = rewriteUnityWebConfigText(originalText, record.path);
          if (!rewrite.changed) {
            continue;
          }
          rewrittenText = rewrite.text;
          rewrittenMime = "application/json";
          rewrittenUnityConfigCount += 1;
        } else if (/\.(?:js|mjs|cjs)$/i.test(record.path)) {
          const originalText = await record.blob.text();
          const emsPatchedText = await patchEmscriptenWasmScriptText(
            originalText,
            record.path,
            recordsByPath,
            dataUrlCache
          );
          rewrittenText = await rewriteImportScriptsText(
            emsPatchedText,
            record.path,
            recordsByPath,
            dataUrlCache
          );
          if (rewrittenText && rewrittenText.indexOf("document.baseURI||self.location.href") !== -1) {
            const baseDir = (() => {
              const dir = dirnamePath(record.path);
              if (!dir) {
                return VFS_ORIGIN;
              }
              const encoded = dir.split("/").map(encodeURIComponent).join("/");
              return VFS_ORIGIN + encoded + "/";
            })();
            const prefix =
              "(function(){try{if(typeof self!=='undefined'){self.__launcherBaseHref=" +
              JSON.stringify(baseDir) +
              ";}}catch(_e){}})();";
            rewrittenText = prefix + rewrittenText.replaceAll(
              "document.baseURI||self.location.href",
              "(self.__launcherBaseHref||document.baseURI||self.location.href)"
            );
          }
          if (rewrittenText === originalText) {
            continue;
          }
          rewrittenMime = "application/javascript";
        } else {
          continue;
        }

        const oldUrl = state.objectUrls.get(record.path);
        const rewrittenBlob = new Blob([rewrittenText], {
          type: rewrittenMime || record.type || mimeFromPath(record.path)
        });
        record.blob = rewrittenBlob;
        record.size = rewrittenBlob.size;
        record.type = rewrittenBlob.type;
        const rewrittenUrl = host.URL.createObjectURL(rewrittenBlob);
        state.objectUrls.set(record.path, rewrittenUrl);
        if (oldUrl) {
          host.URL.revokeObjectURL(oldUrl);
        }
      } catch (error) {
        console.error(error);
        log("Failed to rewrite asset " + record.path + ".", "error");
      }
    }

    if (rewrittenCssCount > 0) {
      log("Rewrote " + rewrittenCssCount + " stylesheet(s) for local asset URLs.");
    }
    if (rewrittenUnityConfigCount > 0) {
      log("Applied Unity GPU-safe config to " + rewrittenUnityConfigCount + " Web config file(s).");
    }
  }

function rewriteSrcSet(value, baseHref) {
    if (typeof value !== "string") {
      return value;
    }
    let changed = false;
    const items = value.split(",");
    const rewritten = items.map((item) => {
      const trimmed = item.trim();
      if (!trimmed) {
        return trimmed;
      }
      const match = trimmed.match(/^(\S+)(\s+.*)?$/);
      if (!match) {
        return trimmed;
      }
      const mapped = requestToObjectUrl(match[1], baseHref);
      if (!mapped) {
        return trimmed;
      }
      changed = true;
      return mapped + (match[2] || "");
    });
    return changed ? rewritten.join(", ") : value;
  }

function injectRuntimeBridge(documentNode, options = {}) {
    const bridgeMeta = {
      gameId: typeof options.gameId === "string" ? options.gameId : "",
      gameName: typeof options.gameName === "string" ? options.gameName : "",
      entryPath: typeof options.entryPath === "string" ? normalizePath(options.entryPath) : ""
    };
    const script = documentNode.createElement("script");
    script.textContent = `
(function () {
  var __launcherBridgeMeta = ${JSON.stringify(bridgeMeta)};
  var __launcherVfsOrigin = ${JSON.stringify(VFS_ORIGIN)};
  var __errorArgToString = function (value) {
    if (value == null) return String(value);
    if (value instanceof Error) {
      return String(value.name || "Error") + ": " + String(value.message || "") + (value.stack ? " | " + String(value.stack) : "");
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (_error) {
        return Object.prototype.toString.call(value);
      }
    }
    return String(value);
  };

  var __getLauncherHost = function () {
    try {
      if (window.parent && window.parent !== window && typeof window.parent.postMessage === "function") {
        return window.parent;
      }
    } catch (_error) {
      // continue
    }
    try {
      if (window.opener && !window.opener.closed && typeof window.opener.postMessage === "function") {
        return window.opener;
      }
    } catch (_error) {
      // no host
    }
    return null;
  };

  var __reportLauncherError = function (details) {
    var host = __getLauncherHost();
    if (!host) {
      return;
    }
    var payload = Object.assign(
      {
        __cbgamesPlayerLog: true,
        level: "error",
        timestamp: Date.now(),
        gameId: __launcherBridgeMeta.gameId || "",
        gameName: __launcherBridgeMeta.gameName || "",
        entryPath: __launcherBridgeMeta.entryPath || ""
      },
      details || {}
    );
    try {
      host.postMessage(payload, "*");
    } catch (_error) {
      // ignore report failure
    }
  };

  var getResolverHost = function () {
    try {
      if (window.parent && window.parent !== window && typeof window.parent.__loaderResolve === "function") {
        return window.parent;
      }
    } catch (_error) {
      // continue to opener fallback
    }
    try {
      if (window.opener && !window.opener.closed && typeof window.opener.__loaderResolve === "function") {
        return window.opener;
      }
    } catch (_error) {
      // no resolver host available
    }
    return null;
  };

  var getBaseHref = function () {
    var baseEl = document.querySelector("base[href]");
    if (baseEl && baseEl.href) {
      return baseEl.href;
    }
    return document.baseURI;
  };

  var resolver = function (value) {
    try {
      var host = getResolverHost();
      if (!host) return null;
      return host.__loaderResolve(String(value), getBaseHref());
    } catch (_error) {
      return null;
    }
  };

  // Block Network Requests for SDK Games:
  // - Currently only used for AZ Games.
  // - blockedHostSuffixes: block requests to these host suffixes for all games.
  // - blockAllNetworkForGames: optional per-game full network block (HTTP(S)/WS(S)).
  // Add entries here to extend blocking for more vendors/games.
  var NETWORK_BLOCK_POLICY = {
    blockedHostSuffixes: [
      "azgame.io",
      "azgames.io"
    ],
    blockAllNetworkForGames: [
      // Example: "escape-road-city-2"
      // Example wildcard: "escape-road-*"
    ]
  };

  var __normalizeLower = function (value) {
    return String(value == null ? "" : value).trim().toLowerCase();
  };

  var __currentGameId = __normalizeLower(__launcherBridgeMeta.gameId || "");

  var __matchesGameToken = function (gameId, token) {
    var cleanToken = __normalizeLower(token);
    if (!cleanToken) {
      return false;
    }
    if (cleanToken.endsWith("*")) {
      return gameId.indexOf(cleanToken.slice(0, -1)) === 0;
    }
    return gameId === cleanToken;
  };

  var __blockAllNetworkForCurrentGame = (function () {
    var rules = Array.isArray(NETWORK_BLOCK_POLICY.blockAllNetworkForGames)
      ? NETWORK_BLOCK_POLICY.blockAllNetworkForGames
      : [];
    for (var i = 0; i < rules.length; i++) {
      if (__matchesGameToken(__currentGameId, rules[i])) {
        return true;
      }
    }
    return false;
  })();

  var __launcherVfsOriginParsed = (function () {
    try {
      return new URL(__launcherVfsOrigin);
    } catch (_error) {
      return null;
    }
  })();

  var __isBlockedHost = function (hostname) {
    var host = __normalizeLower(hostname);
    if (!host) {
      return false;
    }
    var suffixes = Array.isArray(NETWORK_BLOCK_POLICY.blockedHostSuffixes)
      ? NETWORK_BLOCK_POLICY.blockedHostSuffixes
      : [];
    for (var i = 0; i < suffixes.length; i++) {
      var suffix = __normalizeLower(suffixes[i]);
      if (!suffix) {
        continue;
      }
      if (host === suffix || host.endsWith("." + suffix)) {
        return true;
      }
    }
    return false;
  };

  var __parseNetworkUrl = function (value) {
    try {
      if (value instanceof URL) {
        return value;
      }
    } catch (_error) {
      // continue
    }
    var text = String(value == null ? "" : value).trim();
    if (!text) {
      return null;
    }
    var lower = text.toLowerCase();
    if (
      lower.startsWith("data:") ||
      lower.startsWith("blob:") ||
      lower.startsWith("about:") ||
      lower.startsWith("javascript:")
    ) {
      return null;
    }
    var isAbsolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text) || text.startsWith("//");
    var baseHref = "";
    try {
      baseHref = getBaseHref();
    } catch (_error) {
      baseHref = "";
    }
    if (!isAbsolute) {
      return null;
    }
    try {
      if (typeof URL !== "undefined" && typeof URL.canParse === "function") {
        if (!URL.canParse(text, baseHref || undefined)) {
          return null;
        }
      }
      return new URL(text, baseHref || undefined);
    } catch (_error) {
      return null;
    }
  };

  var __isRemoteProtocol = function (protocol) {
    var p = __normalizeLower(protocol);
    return p === "http:" || p === "https:" || p === "ws:" || p === "wss:";
  };

  var __getBlockedNetworkTarget = function (value) {
    var parsed = __parseNetworkUrl(value);
    if (!parsed || !__isRemoteProtocol(parsed.protocol)) {
      return "";
    }
    if (__launcherVfsOriginParsed && parsed.origin === __launcherVfsOriginParsed.origin) {
      return "";
    }
    if (__blockAllNetworkForCurrentGame) {
      return parsed.href;
    }
    if (__isBlockedHost(parsed.hostname)) {
      return parsed.href;
    }
    return "";
  };

  var __reportBlockedNetwork = function (kind, targetUrl) {
    __reportLauncherError({
      level: "warn",
      kind: "blocked-network",
      message: String(kind || "network") + " blocked by launcher policy: " + String(targetUrl || "")
    });
  };

  var normalizeVirtualDataUrl = function (value) {
    var text = String(value == null ? "" : value);
    var marker = "data:application/";
    var markerIndex = text.indexOf(marker);
    if (markerIndex > 0 && text.indexOf(__launcherVfsOrigin) === 0) {
      return text.slice(markerIndex);
    }
    return value;
  };

  var __fileUrlToCandidates = function (value) {
    if (typeof value !== "string") return [];
    var text = value.trim();
    if (!/^file:/i.test(text)) return [];
    try {
      var parsed = new URL(text);
      if (parsed.protocol !== "file:") return [];
      var pathname = decodeURIComponent(parsed.pathname || "");
      if (!pathname) return [];
      var normalized = pathname.replace(/\\\\/g, "/");
      var out = [];
      var base = normalized.replace(/^\\/+/, "");
      if (base) out.push(base);
      var lower = normalized.toLowerCase();
      var markers = ["/streamingassets/", "/build/", "/templatedata/"];
      for (var i = 0; i < markers.length; i++) {
        var idx = lower.lastIndexOf(markers[i]);
        if (idx >= 0) {
          var candidate = normalized.slice(idx + 1).replace(/^\\/+/, "");
          if (candidate && out.indexOf(candidate) === -1) {
            out.push(candidate);
          }
        }
      }
      return out;
    } catch (_error) {
      return [];
    }
  };

  var mapValue = function (value) {
    var normalized = normalizeVirtualDataUrl(value);
    var mapped = resolver(normalized);
    if (!mapped && typeof normalized === "string" && /^file:/i.test(normalized)) {
      var candidates = __fileUrlToCandidates(normalized);
      for (var i = 0; i < candidates.length; i++) {
        var attempt = resolver(candidates[i]);
        if (attempt) {
          mapped = attempt;
          break;
        }
      }
    }
    var candidate = mapped || normalized;
    var blockedTarget = __getBlockedNetworkTarget(candidate) || __getBlockedNetworkTarget(normalized);
    if (blockedTarget) {
      return "about:blank#cbgames-blocked-network";
    }
    return candidate;
  };

  var isMappedAttributeName = function (name) {
    var attr = String(name || "").toLowerCase();
    return (
      attr === "srcset" ||
      attr === "src" ||
      attr === "href" ||
      attr === "xlink:href" ||
      attr.endsWith(":href") ||
      attr === "data" ||
      attr === "poster" ||
      attr === "action"
    );
  };

  var UNITY_GPU_SAFE_MODE = true;
  var UNITY_FORCE_WEBGL1 = false;
  var UNITY_CLAMP_DEVICE_PIXEL_RATIO = 1;

  var mapSrcSet = function (value) {
    if (typeof value !== "string") return value;
    var changed = false;
    var rewritten = value.split(",").map(function (item) {
      var trimmed = item.trim();
      if (!trimmed) return trimmed;
      var match = trimmed.match(/^(\\S+)(\\s+.*)?$/);
      if (!match) return trimmed;
      var mapped = resolver(match[1]);
      if (!mapped) return trimmed;
      changed = true;
      return mapped + (match[2] || "");
    });
    return changed ? rewritten.join(", ") : value;
  };

  var rewriteCssRuntime = function (value) {
    if (typeof value !== "string" || !value) return value;
    return value.replace(
      /url\\(\\s*(['"]?)([^"')]+)\\1\\s*\\)/gi,
      function (full, quote, urlPath) {
        var mapped = resolver(urlPath);
        if (!mapped) return full;
        var wrapped = quote || '"';
        return "url(" + wrapped + mapped + wrapped + ")";
      }
    );
  };

  var remapElementTree = function (root) {
    if (!root) return;
    var targetAttrs = [
      "src",
      "href",
      "xlink:href",
      "data",
      "poster",
      "action"
    ];
    var all = [];
    if (root.nodeType === 1) {
      all.push(root);
    }
    if (root.querySelectorAll) {
      var nested = root.querySelectorAll("*");
      for (var n = 0; n < nested.length; n++) {
        all.push(nested[n]);
      }
    }
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      for (var a = 0; a < targetAttrs.length; a++) {
        var attr = targetAttrs[a];
        if (!el.hasAttribute(attr)) continue;
        var current = el.getAttribute(attr);
        var mapped = mapValue(current);
        if (mapped !== current) {
          el.setAttribute(attr, mapped);
        }
      }
      if (el.hasAttribute("srcset")) {
        var currentSrcSet = el.getAttribute("srcset");
        var mappedSrcSet = mapSrcSet(currentSrcSet);
        if (mappedSrcSet !== currentSrcSet) {
          el.setAttribute("srcset", mappedSrcSet);
        }
      }
      if (el.hasAttribute("style")) {
        var currentStyle = el.getAttribute("style");
        var mappedStyle = rewriteCssRuntime(currentStyle);
        if (mappedStyle !== currentStyle) {
          el.setAttribute("style", mappedStyle);
        }
      }
      if (el.tagName === "STYLE") {
        var cssText = el.textContent || "";
        var cssMapped = rewriteCssRuntime(cssText);
        if (cssMapped !== cssText) {
          el.textContent = cssMapped;
        }
      }
    }
  };

  var patchProperty = function (ctor, prop, mapper) {
    if (!ctor || !ctor.prototype) return;
    var desc = Object.getOwnPropertyDescriptor(ctor.prototype, prop);
    if (!desc || typeof desc.get !== "function" || typeof desc.set !== "function") return;
    var convert = mapper || mapValue;
    Object.defineProperty(ctor.prototype, prop, {
      configurable: desc.configurable,
      enumerable: desc.enumerable,
      get: function () {
        return desc.get.call(this);
      },
      set: function (value) {
        desc.set.call(this, convert(value));
      }
    });
  };

  var nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    var attr = String(name || "").toLowerCase();
    if (attr === "style") {
      value = rewriteCssRuntime(String(value || ""));
    } else if (attr === "srcset") {
      value = mapSrcSet(value);
    } else if (isMappedAttributeName(attr)) {
      value = mapValue(value);
    }
    return nativeSetAttribute.call(this, name, value);
  };

  if (Element.prototype.setAttributeNS) {
    var nativeSetAttributeNS = Element.prototype.setAttributeNS;
    Element.prototype.setAttributeNS = function (namespace, name, value) {
      var attr = String(name || "").toLowerCase();
      if (attr === "style") {
        value = rewriteCssRuntime(String(value || ""));
      } else if (attr === "srcset") {
        value = mapSrcSet(value);
      } else if (isMappedAttributeName(attr)) {
        value = mapValue(value);
      }
      return nativeSetAttributeNS.call(this, namespace, name, value);
    };
  }

  patchProperty(HTMLScriptElement, "src");
  patchProperty(HTMLLinkElement, "href");
  patchProperty(HTMLImageElement, "src");
  patchProperty(HTMLImageElement, "srcset", mapSrcSet);
  patchProperty(HTMLIFrameElement, "src");
  patchProperty(HTMLObjectElement, "data");
  patchProperty(HTMLEmbedElement, "src");
  patchProperty(HTMLAnchorElement, "href");
  patchProperty(HTMLFormElement, "action");
  patchProperty(HTMLSourceElement, "src");
  patchProperty(HTMLTrackElement, "src");
  patchProperty(HTMLInputElement, "src");
  if (window.HTMLMediaElement) {
    patchProperty(HTMLMediaElement, "src");
  }
  if (window.Audio) {
    var NativeAudio = window.Audio;
    window.Audio = function (src) {
      if (!arguments.length) {
        return new NativeAudio();
      }
      return new NativeAudio(mapValue(src));
    };
    window.Audio.prototype = NativeAudio.prototype;
  }

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === "string" || input instanceof URL) {
      var originalInput = input;
      var mappedInput = mapValue(input);
      var blockedTarget = __getBlockedNetworkTarget(mappedInput) || __getBlockedNetworkTarget(originalInput);
      if (blockedTarget) {
        __reportBlockedNetwork("fetch", blockedTarget);
        return Promise.reject(new TypeError("Network request blocked by launcher policy."));
      }
      if (mappedInput === originalInput) {
        return nativeFetch(originalInput, init);
      }
      return nativeFetch(mappedInput, init).catch(function () {
        return nativeFetch(originalInput, init);
      });
    }
    if (input instanceof Request) {
      var blockedRequestTarget = __getBlockedNetworkTarget(input.url);
      if (blockedRequestTarget) {
        __reportBlockedNetwork("fetch", blockedRequestTarget);
        return Promise.reject(new TypeError("Network request blocked by launcher policy."));
      }
      var mapped = resolver(input.url);
      if (mapped) {
        var blockedMappedTarget = __getBlockedNetworkTarget(mapped);
        if (blockedMappedTarget) {
          __reportBlockedNetwork("fetch", blockedMappedTarget);
          return Promise.reject(new TypeError("Network request blocked by launcher policy."));
        }
        try {
          return nativeFetch(new Request(mapped, input), init).catch(function () {
            return nativeFetch(input, init);
          });
        } catch (_error) {
          return nativeFetch(input, init);
        }
      }
    }
    return nativeFetch(input, init);
  };

  if (window.Request) {
    var NativeRequest = window.Request;
    window.Request = function (input, init) {
      if (typeof input === "string" || input instanceof URL) {
        var mapped = mapValue(input);
        try {
          return new NativeRequest(mapped, init);
        } catch (_mappedError) {
          return new NativeRequest(input, init);
        }
      }
      if (input instanceof NativeRequest) {
        return new NativeRequest(input, init);
      }
      return new NativeRequest(input, init);
    };
    window.Request.prototype = NativeRequest.prototype;
  }

  var nativeOpen = XMLHttpRequest.prototype.open;
  var nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    var rest = Array.prototype.slice.call(arguments, 2);
    var originalUrl = url;
    var mappedUrl = mapValue(url);
    if (typeof mappedUrl !== "string") {
      mappedUrl = String(mappedUrl == null ? "" : mappedUrl);
    }
    if (!mappedUrl) {
      mappedUrl = typeof originalUrl === "string" ? originalUrl : "";
    }
    if (!mappedUrl) {
      mappedUrl = "about:blank";
    }
    var blockedTarget = __getBlockedNetworkTarget(mappedUrl) || __getBlockedNetworkTarget(originalUrl);
    this.__cbgamesBlockedNetworkTarget = blockedTarget || "";
    if (this.__cbgamesBlockedNetworkTarget) {
      return nativeOpen.apply(this, [method, "about:blank"].concat(rest));
    }
    try {
      return nativeOpen.apply(this, [method, mappedUrl].concat(rest));
    } catch (mappedOpenError) {
      var fallbackUrl = typeof originalUrl === "string" && originalUrl.trim()
        ? originalUrl
        : "about:blank";
      try {
        return nativeOpen.apply(this, [method, fallbackUrl].concat(rest));
      } catch (_originalOpenError) {
        return nativeOpen.apply(this, [method, "about:blank"].concat(rest));
      }
    }
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__cbgamesBlockedNetworkTarget) {
      var blockedTarget = this.__cbgamesBlockedNetworkTarget;
      this.__cbgamesBlockedNetworkTarget = "";
      __reportBlockedNetwork("xhr", blockedTarget);
      throw new TypeError("Network request blocked by launcher policy.");
    }
    return nativeSend.call(this, body);
  };

  if (window.navigator && typeof window.navigator.sendBeacon === "function") {
    var nativeSendBeacon = window.navigator.sendBeacon.bind(window.navigator);
    window.navigator.sendBeacon = function (url, data) {
      var blockedTarget = __getBlockedNetworkTarget(url);
      if (blockedTarget) {
        __reportBlockedNetwork("sendBeacon", blockedTarget);
        return false;
      }
      return nativeSendBeacon(url, data);
    };
  }

  if (window.WebSocket) {
    var NativeWebSocket = window.WebSocket;
    window.WebSocket = function (url, protocols) {
      var blockedTarget = __getBlockedNetworkTarget(url);
      if (blockedTarget) {
        __reportBlockedNetwork("websocket", blockedTarget);
        throw new TypeError("Network request blocked by launcher policy.");
      }
      if (typeof protocols === "undefined") {
        return new NativeWebSocket(url);
      }
      return new NativeWebSocket(url, protocols);
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
  }

  if (window.Worker) {
    var NativeWorker = window.Worker;
    window.Worker = function (url, options) {
      return new NativeWorker(mapValue(url), options);
    };
    window.Worker.prototype = NativeWorker.prototype;
  }

  if (window.SharedWorker) {
    var NativeSharedWorker = window.SharedWorker;
    window.SharedWorker = function (url, options) {
      return new NativeSharedWorker(mapValue(url), options);
    };
    window.SharedWorker.prototype = NativeSharedWorker.prototype;
  }

  if (window.FontFace) {
    var NativeFontFace = window.FontFace;
    window.FontFace = function (family, source, descriptors) {
      var nextSource = source;
      if (typeof source === "string") {
        nextSource = source.replace(
          /url\\(\\s*(['"]?)([^"')]+)\\1\\s*\\)/gi,
          function (full, quote, urlPath) {
            var mapped = resolver(urlPath);
            if (!mapped) {
              return full;
            }
            var wrapped = quote || '"';
            return "url(" + wrapped + mapped + wrapped + ")";
          }
        );
      }
      return new NativeFontFace(family, nextSource, descriptors);
    };
    window.FontFace.prototype = NativeFontFace.prototype;
  }

  var innerHtmlDesc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  if (innerHtmlDesc && typeof innerHtmlDesc.get === "function" && typeof innerHtmlDesc.set === "function") {
    Object.defineProperty(Element.prototype, "innerHTML", {
      configurable: innerHtmlDesc.configurable,
      enumerable: innerHtmlDesc.enumerable,
      get: function () {
        return innerHtmlDesc.get.call(this);
      },
      set: function (value) {
        innerHtmlDesc.set.call(this, value);
        remapElementTree(this);
      }
    });
  }

  if (window.CSSStyleSheet && CSSStyleSheet.prototype) {
    var nativeInsertRule = CSSStyleSheet.prototype.insertRule;
    if (typeof nativeInsertRule === "function") {
      CSSStyleSheet.prototype.insertRule = function (rule, index) {
        return nativeInsertRule.call(this, rewriteCssRuntime(String(rule || "")), index);
      };
    }
  }

  remapElementTree(document.documentElement || document);

  if (window.MutationObserver) {
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (mutation.type === "attributes" && mutation.target) {
          remapElementTree(mutation.target);
          continue;
        }
        if (mutation.type === "childList") {
          for (var j = 0; j < mutation.addedNodes.length; j++) {
            var node = mutation.addedNodes[j];
            if (node && node.nodeType === 1) {
              remapElementTree(node);
            }
          }
        }
      }
    });
    observer.observe(document.documentElement || document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "href", "xlink:href", "data", "poster", "action", "srcset", "style"]
    });
  }

  var installWebGLSafetyPatch = function () {
    if (!UNITY_GPU_SAFE_MODE || !window.HTMLCanvasElement || !HTMLCanvasElement.prototype) {
      return;
    }
    if (window.__loaderWebglSafetyInstalled) {
      return;
    }
    window.__loaderWebglSafetyInstalled = true;

    var forcedDpr = Number(UNITY_CLAMP_DEVICE_PIXEL_RATIO) || 0;
    if (forcedDpr > 0) {
      try {
        Object.defineProperty(window, "devicePixelRatio", {
          configurable: true,
          get: function () {
            return forcedDpr;
          }
        });
      } catch (_error) {
        // read-only in some environments
      }
    }

    var nativeGetContext = HTMLCanvasElement.prototype.getContext;
    if (typeof nativeGetContext !== "function") {
      return;
    }

    var isLikelyUnityPage = function () {
      try {
        if (typeof window.createUnityInstance === "function" || typeof window.UnityLoader !== "undefined") {
          return true;
        }
      } catch (_error) {
        // ignore and continue to DOM checks
      }
      try {
        return !!document.querySelector(
          'script[src*="UnityLoader"], script[src*="unityloader"], script[src*="/Build/"], script[src*="framework"]'
        );
      } catch (_error) {
        return false;
      }
    };

    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      var kind = String(type || "").toLowerCase();
      if (UNITY_FORCE_WEBGL1 && kind === "webgl2" && isLikelyUnityPage()) {
        return null;
      }

      if (
        kind === "webgl" ||
        kind === "experimental-webgl" ||
        kind === "webgl2"
      ) {
        var nextAttrs = Object.assign({}, attrs || {}, {
          antialias: false,
          alpha: false,
          stencil: false,
          premultipliedAlpha: false,
          preserveDrawingBuffer: false,
          desynchronized: true,
          powerPreference: "low-power"
        });
        return nativeGetContext.call(this, type, nextAttrs);
      }

      return nativeGetContext.call(this, type, attrs);
    };

    console.log("[GPU Safe] WebGL safety mode active (low-memory attrs; WebGL1 fallback for Unity pages).");
  };
  installWebGLSafetyPatch();

  var ensureVisibleSurface = function () {
    try {
      if (
        typeof window.createUnityInstance !== "function" &&
        typeof window.UnityLoader === "undefined" &&
        !document.querySelector(
          'script[src*="UnityLoader"], script[src*="unityloader"], script[src*="/Build/"], script[src*="framework"]'
        )
      ) {
        return;
      }
    } catch (_error) {
      return;
    }
    if (!document.documentElement || !document.body) {
      return;
    }
    if (!document.documentElement.style.height) {
      document.documentElement.style.height = "100%";
    }
    if (!document.body.style.height) {
      document.body.style.height = "100%";
    }
    if (!document.body.style.margin || document.body.style.margin === "8px") {
      document.body.style.margin = "0";
    }

    var isLikelyPrimaryCanvas = function (canvas) {
      if (!canvas || canvas.tagName !== "CANVAS") return false;
      var id = String(canvas.id || "").toLowerCase();
      var className = "";
      try {
        className = String(canvas.className || "").toLowerCase();
      } catch (_error) {
        className = "";
      }
      if (
        id === "unity-canvas" ||
        id === "canvas" ||
        id === "gamecanvas" ||
        id === "glcanvas" ||
        id === "webgl-canvas" ||
        id.indexOf("unity") !== -1
      ) {
        return true;
      }
      if (className.indexOf("unity") !== -1 || className.indexOf("webgl") !== -1) {
        return true;
      }
      var styleWidth = String((canvas.style && canvas.style.width) || "").toLowerCase();
      var styleHeight = String((canvas.style && canvas.style.height) || "").toLowerCase();
      if (
        styleWidth === "100%" ||
        styleWidth === "100vw" ||
        styleHeight === "100%" ||
        styleHeight === "100vh"
      ) {
        return true;
      }
      try {
        return document.querySelectorAll("canvas").length <= 1;
      } catch (_error) {
        return false;
      }
    };

    var fixBox = function (element) {
      if (!element || !element.getBoundingClientRect) return;
      var isCanvas = element.tagName === "CANVAS";
      if (isCanvas) {
        var hasIntrinsicCanvasSize = Number(element.width) > 0 && Number(element.height) > 0;
        if (hasIntrinsicCanvasSize && !isLikelyPrimaryCanvas(element)) {
          return;
        }
      }
      var rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (!isCanvas || (element.width > 0 && element.height > 0))) {
        return;
      }

      var widthStyle = element.style.width || "";
      var heightStyle = element.style.height || "";
      if (!widthStyle || widthStyle === "100%" || widthStyle === "0px") {
        element.style.width = "100vw";
      }
      if (!heightStyle || heightStyle === "100%" || heightStyle === "0px") {
        element.style.height = "100vh";
      }
      if (!element.style.display) {
        element.style.display = "block";
      }
      if (!element.style.position || element.style.position === "static") {
        element.style.position = "relative";
      }

      if (isCanvas) {
        var viewportWidth = Math.max(window.innerWidth || 0, 1);
        var viewportHeight = Math.max(window.innerHeight || 0, 1);
        if (!element.width || element.width === 0) {
          element.width = viewportWidth;
        }
        if (!element.height || element.height === 0) {
          element.height = viewportHeight;
        }
      }
    };

    var roots = [
      document.getElementById("gameContainer"),
      document.getElementById("unityContainer"),
      document.getElementById("unity-canvas"),
      document.querySelector(".webgl-content"),
      document.querySelector("#canvas")
    ];

    for (var i = 0; i < roots.length; i++) {
      fixBox(roots[i]);
    }

    var canvases = document.querySelectorAll("canvas");
    for (var c = 0; c < canvases.length; c++) {
      var canvas = canvases[c];
      if (!isLikelyPrimaryCanvas(canvas)) {
        continue;
      }
      fixBox(canvas);
      if (canvas.parentElement) {
        fixBox(canvas.parentElement);
      }
    }
  };

  window.addEventListener("load", function () {
    ensureVisibleSurface();
    try {
      window.dispatchEvent(new Event("resize"));
    } catch (_error) {
      // ignore
    }
  });
  window.addEventListener("resize", ensureVisibleSurface);
  document.addEventListener("DOMContentLoaded", ensureVisibleSurface);
  var surfaceTries = 0;
  var surfaceTimer = setInterval(function () {
    ensureVisibleSurface();
    surfaceTries += 1;
    if (surfaceTries >= 40) {
      clearInterval(surfaceTimer);
    }
  }, 250);

  window.addEventListener(
    "error",
    function (event) {
      var target = event && event.target;
      if (!target || target === window) return;
      var badUrl = target.src || target.href || target.data || "";
      if (typeof badUrl === "string" && badUrl.indexOf("https://loader.invalid/") === 0) {
        console.error("Unresolved asset URL:", badUrl);
      }
    },
    true
  );

  window.addEventListener(
    "error",
    function (event) {
      var errorObj = event && event.error;
      __reportLauncherError({
        kind: "error-event",
        message: (event && event.message) ? String(event.message) : (errorObj && errorObj.message ? String(errorObj.message) : "Script error"),
        source: event && event.filename ? String(event.filename) : "",
        lineno: event && event.lineno ? Number(event.lineno) : 0,
        colno: event && event.colno ? Number(event.colno) : 0,
        stack: errorObj && errorObj.stack ? String(errorObj.stack) : ""
      });
    },
    true
  );

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event ? event.reason : null;
    var message = reason && reason.message ? String(reason.message) : __errorArgToString(reason || "Unhandled promise rejection");
    __reportLauncherError({
      kind: "unhandledrejection",
      message: message,
      stack: reason && reason.stack ? String(reason.stack) : ""
    });
  });

  if (window.console && typeof window.console.error === "function") {
    var __nativeConsoleError = window.console.error.bind(window.console);
    window.console.error = function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        parts.push(__errorArgToString(arguments[i]));
      }
      __reportLauncherError({
        kind: "console.error",
        message: parts.join(" | ")
      });
      return __nativeConsoleError.apply(window.console, arguments);
    };
  }

  // Suppress popups that mention file:// from bundled games.
  (function () {
    var originalAlert = window.alert;
    var originalConfirm = window.confirm;
    var originalPrompt = window.prompt;
    var shouldSuppress = function (message) {
      var text = String(message || "");
      return /file:/i.test(text);
    };
    if (typeof originalAlert === "function") {
      window.alert = function (message) {
        if (shouldSuppress(message)) {
          console.warn("Suppressed popup containing file://:", String(message || ""));
          return;
        }
        return originalAlert.call(window, message);
      };
    }
    if (typeof originalConfirm === "function") {
      window.confirm = function (message) {
        if (shouldSuppress(message)) {
          console.warn("Suppressed popup containing file://:", String(message || ""));
          return true;
        }
        return originalConfirm.call(window, message);
      };
    }
    if (typeof originalPrompt === "function") {
      window.prompt = function (message, defaultValue) {
        if (shouldSuppress(message)) {
          console.warn("Suppressed popup containing file://:", String(message || ""));
          return defaultValue == null ? "" : String(defaultValue);
        }
        return originalPrompt.call(window, message, defaultValue);
      };
    }
  })();
})();
`;
    const base = documentNode.head.querySelector("base");
    if (base && base.nextSibling) {
      documentNode.head.insertBefore(script, base.nextSibling);
      return;
    }
    if (base) {
      documentNode.head.append(script);
      return;
    }
    documentNode.head.prepend(script);
  }

function rewriteDocumentHtml(htmlText, entryPath, runtimeBridgeOptions = {}) {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(htmlText, "text/html");
    const baseHref = toVirtualUrl(entryPath);

    let baseElement = documentNode.querySelector("base");
    if (!baseElement) {
      baseElement = documentNode.createElement("base");
      documentNode.head.prepend(baseElement);
    }
    baseElement.setAttribute("href", baseHref);

    for (const manifestLink of documentNode.querySelectorAll('link[rel="manifest"]')) {
      manifestLink.remove();
    }

    // Strip Cloudflare challenge/telemetry snippets that are unusable offline.
    for (const scriptElement of documentNode.querySelectorAll("script")) {
      const src = String(scriptElement.getAttribute("src") || "").toLowerCase();
      const inline = String(scriptElement.textContent || "").toLowerCase();
      const hasCfBeaconAttr = scriptElement.hasAttribute("data-cf-beacon");
      if (
        src.includes("/cdn-cgi/challenge-platform/") ||
        inline.includes("/cdn-cgi/challenge-platform/") ||
        inline.includes("__cf$cv$params") ||
        src.includes("static.cloudflareinsights.com/beacon.min.js") ||
        inline.includes("static.cloudflareinsights.com/beacon.min.js") ||
        hasCfBeaconAttr
      ) {
        scriptElement.remove();
      }
    }

    for (const styleElement of documentNode.querySelectorAll("style")) {
      const originalCss = String(styleElement.textContent || "");
      if (!originalCss) {
        continue;
      }
      const rewrittenCss = rewriteCssTextForBase(originalCss, baseHref);
      if (!rewrittenCss.trim()) {
        styleElement.remove();
        continue;
      }
      if (rewrittenCss !== originalCss) {
        styleElement.textContent = rewrittenCss;
      }
    }

    for (const element of documentNode.querySelectorAll("[style]")) {
      const originalStyle = element.getAttribute("style");
      const rewrittenStyle = rewriteCssTextForBase(originalStyle, baseHref);
      if (rewrittenStyle !== originalStyle) {
        element.setAttribute("style", rewrittenStyle);
      }
    }

    const targets = [
      ["script", "src"],
      ["link", "href"],
      ["img", "src"],
      ["audio", "src"],
      ["video", "src"],
      ["source", "src"],
      ["track", "src"],
      ["object", "data"],
      ["embed", "src"],
      ["iframe", "src"]
    ];

    for (const [selector, attribute] of targets) {
      const elements = documentNode.querySelectorAll(selector + "[" + attribute + "]");
      for (const element of elements) {
        const original = element.getAttribute(attribute);
        const mapped = requestToObjectUrl(original, baseHref);
        if (mapped) {
          element.setAttribute(attribute, mapped);
        }
      }
    }

    for (const element of documentNode.querySelectorAll("[srcset]")) {
      const rewritten = rewriteSrcSet(element.getAttribute("srcset"), baseHref);
      element.setAttribute("srcset", rewritten);
    }

    injectRuntimeBridge(documentNode, runtimeBridgeOptions);
    return "<!DOCTYPE html>\n" + documentNode.documentElement.outerHTML;
  }

function canAccessPlayerWindow(win) {
    if (!win || win.closed) {
      return false;
    }
    try {
      void win.document;
      return true;
    } catch {
      return false;
    }
  }

function openPlayerWindow() {
    const reused = window.open("about:blank", "cbgamesOfflinePlayer");
    if (canAccessPlayerWindow(reused)) {
      return reused;
    }
    // Fallback: request a fresh unnamed window if named context is unavailable.
    const fresh = window.open("about:blank");
    if (canAccessPlayerWindow(fresh)) {
      return fresh;
    }
    return null;
  }
