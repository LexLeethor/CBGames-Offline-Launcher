"use strict";

// Binary media can be persisted as soon as it downloads; text stays pending for patching.
function isStreamablePath(path) {
    return /\.(?:mp4|webm|ogg|ogv|mov|mkv|png|jpe?g|gif|webp|avif|mp3|wav|flac|m4a)$/i.test(String(path || ""));
}

async function fetchLatestGithubReleaseInfo(owner, repo, preferredAssetName) {
    const apiUrl = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/releases/latest";
    const response = await fetch(apiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json"
      }
    });
    if (!response.ok) {
      const extra = response.status === 404 ? " No latest release found for this repo." : "";
      throw new Error("GitHub release lookup failed (" + response.status + ")." + extra);
    }
    const release = await response.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const preferredName = String(preferredAssetName || "").trim();
    let asset = null;
    if (preferredName) {
      asset = assets.find((entry) => String(entry && entry.name || "") === preferredName) || null;
    }
    if (!asset) {
      asset = assets.find((entry) => /\.zip$/i.test(String(entry && entry.name || ""))) || null;
    }
    if (!asset || !asset.browser_download_url) {
      throw new Error("Latest release has no .zip asset.");
    }
    const downloadUrl = toHttpUrl(asset.browser_download_url);
    if (!downloadUrl) {
      throw new Error("Latest release ZIP URL is invalid.");
    }
    return {
      provider: "github-release",
      owner,
      repo,
      releaseTag: String(release.tag_name || ""),
      releaseId: Number(release.id) || 0,
      assetId: Number(asset.id) || 0,
      assetName: String(asset.name || ""),
      assetUpdatedAt: Number(Date.parse(asset.updated_at || "")) || 0,
      downloadUrl,
      etag: "",
      lastModified: "",
      lastCheckedAt: Date.now()
    };
  }

async function fetchGithubRepoTreeSnapshot(owner, repo, branchHint) {
    const branchCandidate = String(branchHint || "").trim();
    let branch = branchCandidate;
    if (!branch) {
      const repoApiUrl = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
      const repoResponse = await fetch(repoApiUrl, {
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json"
        }
      });
      const repoRateLimitErr = checkGithubResponseRateLimit(repoResponse);
      if (repoRateLimitErr) {
        throw repoRateLimitErr;
      }
      if (!repoResponse.ok) {
        throw new Error("GitHub repo lookup failed (" + repoResponse.status + ").");
      }
      const repoInfo = await repoResponse.json();
      branch = String(repoInfo.default_branch || "").trim();
      if (!branch) {
        throw new Error("Could not determine repo default branch.");
      }
    }
    const treeApiUrl =
      "https://api.github.com/repos/" +
      encodeURIComponent(owner) + "/" +
      encodeURIComponent(repo) +
      "/git/trees/" + encodeURIComponent(branch) + "?recursive=1";
    const treeResponse = await fetch(treeApiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json"
      }
    });
    const treeRateLimitErr = checkGithubResponseRateLimit(treeResponse);
    if (treeRateLimitErr) {
      throw treeRateLimitErr;
    }
    if (!treeResponse.ok) {
      throw new Error("GitHub tree lookup failed (" + treeResponse.status + ").");
    }
    const tree = await treeResponse.json();
    const treeSha = String(tree.sha || "").trim();
    const rawEntries = Array.isArray(tree.tree) ? tree.tree : [];
    const fileEntries = rawEntries
      .filter((entry) => entry && entry.type === "blob" && typeof entry.path === "string" && entry.path)
      .map((entry) => {
        const sha = String(entry.sha || "").trim();
        const apiBlobUrl = sha
          ? (
              "https://api.github.com/repos/" +
              encodeURIComponent(owner) + "/" +
              encodeURIComponent(repo) +
              "/git/blobs/" +
              encodeURIComponent(sha)
            )
          : "";
        return {
          path: normalizePath(entry.path),
          url: toHttpUrl(entry.url || "") || toHttpUrl(apiBlobUrl),
          sha,
          size: Number(entry.size) || 0
        };
      })
      .filter((entry) => entry.path && entry.url);
    if (!treeSha) {
      throw new Error("GitHub tree response missing SHA.");
    }
    if (!fileEntries.length) {
      throw new Error("Repository has no file blobs to import.");
    }
    return {
      owner,
      repo,
      branch,
      treeSha,
      fileEntries
    };
  }

async function buildZipFileFromGithubTree(snapshot, labelPrefix) {
    const entries = await downloadGithubTreeEntries(snapshot, labelPrefix);
    const zipBlob = createZipStoreArchive(entries);
    const fileName = String(snapshot.repo || "github-repo") + "-" + String(snapshot.branch || "branch") + ".zip";
    return new File([zipBlob], fileName, { type: "application/zip" });
  }

async function downloadGithubTreeEntries(snapshot, labelPrefix) {
  // third arg may be a function or an options object:
  // downloadGithubTreeEntries(snapshot, label, onFile)
  // or downloadGithubTreeEntries(snapshot, label, { onFile, prioritizeSmallest, skipPatterns })
  const third = arguments.length >= 3 ? arguments[2] : null;
  let onFile = null;
  let prioritizeSmallest = false;
  let skipPatterns = [];
  if (typeof third === 'function') {
    onFile = third;
  } else if (third && typeof third === 'object') {
    onFile = typeof third.onFile === 'function' ? third.onFile : null;
    prioritizeSmallest = !!third.prioritizeSmallest;
    skipPatterns = Array.isArray(third.skipPatterns) ? third.skipPatterns.slice() : [];
  }

  const entries = [];
  const filesOrig = Array.isArray(snapshot && snapshot.fileEntries) ? snapshot.fileEntries.slice() : [];
  const owner = String(snapshot && snapshot.owner || "").trim();
  const repo = String(snapshot && snapshot.repo || "").trim();
  const branch = String(snapshot && snapshot.branch || "").trim();
  const progressLabel = String(labelPrefix || "Downloading repo files");

  const defaultSkipNames = {".gitignore": true, ".gitattributes": true, ".gitmodules": true};
  const shouldSkip = (p) => {
    const parts = String(p || "").split('/');
    const base = parts[parts.length - 1] || "";
    if (defaultSkipNames[base]) return true;
    for (const pat of skipPatterns) {
      try {
        const re = (pat instanceof RegExp) ? pat : new RegExp(pat);
        if (re.test(p)) return true;
      } catch (e) {}
    }
    return false;
  };

  let files = filesOrig.filter(f => !shouldSkip(f.path));
  if (prioritizeSmallest) {
    const INF = Number.MAX_SAFE_INTEGER;
    files.sort((a, b) => {
      const as = Number.isFinite(Number(a && a.size)) ? Number(a.size) : INF;
      const bs = Number.isFinite(Number(b && b.size)) ? Number(b.size) : INF;
      return as - bs;
    });
  }

  const hasKnownSizes = files.every((file) => Number.isFinite(file && file.size) && Number(file.size) >= 0);
  let totalBytes = hasKnownSizes
    ? files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
    : 0;
  let downloadedBytes = 0;
  const ensureTotalAtLeast = (value) => {
    const actual = Number(value || 0);
    if (actual > 0 && actual > totalBytes) {
      totalBytes = actual;
    }
  };
  const adjustTotalForActualSize = (actualLength, pointerLength) => {
    const actual = Number(actualLength || 0);
    const pointer = Number(pointerLength || 0);
    const delta = actual - pointer;
    if (delta > 0 && totalBytes > 0) {
      totalBytes += delta;
    }
    ensureTotalAtLeast(downloadedBytes + actual);
  };
  const updateProgress = (fileIndex) => {
    const fileSuffix = files.length > 0
      ? " (" + (fileIndex + 1) + "/" + files.length + ")"
      : "";
    if (totalBytes > 0) {
      setWorkProgress(
        progressLabel + fileSuffix,
        downloadedBytes,
        totalBytes,
        {
          currentText: formatBytes(downloadedBytes),
          totalText: formatBytes(totalBytes)
        }
      );
    } else {
      setWorkProgress(progressLabel + fileSuffix + " (" + formatBytes(downloadedBytes) + ")", 0, 0);
    }
  };
  updateProgress(0);
  setWorkProgressTree(0, files.length, "", files.map(function(f) { return f.path; }));

    const fetchBytesStreaming = async (fileMeta, fileIndex) => {
      const rawUrl = owner && repo && branch
        ? "https://raw.githubusercontent.com/" +
          encodeURIComponent(owner) + "/" +
          encodeURIComponent(repo) + "/" +
          encodeURIComponent(branch) + "/" +
          fileMeta.path.split("/").map(encodeURIComponent).join("/")
        : "";

      if (!rawUrl) {
        throw new Error("Cannot build raw URL for " + fileMeta.path);
      }

      const streamResponseToUint8Array = async (response, fileIndex) => {
        if (!response || !response.body || typeof response.body.getReader !== "function") {
          const buf = await response.arrayBuffer();
          const bytes = new Uint8Array(buf);
          downloadedBytes += bytes.length;
          updateProgress(fileIndex);
          return bytes;
        }
        const reader = response.body.getReader();
        const chunks = [];
        let totalLength = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            totalLength += value.byteLength;
            downloadedBytes += value.byteLength;
            updateProgress(fileIndex);
          }
        }
        const out = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          out.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return out;
      };

      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          // Prefer raw blob bytes from the GitHub API; this avoids decoding a whole base64 payload
          // for every normal file, while still letting us detect LFS pointer content immediately.
          if (fileMeta && fileMeta.sha) {
            try {
              const blobApi =
                "https://api.github.com/repos/" + encodeURIComponent(owner) +
                "/" + encodeURIComponent(repo) +
                "/git/blobs/" + encodeURIComponent(fileMeta.sha);
              const blobResp = await fetch(blobApi, {
                cache: "no-store",
                headers: { Accept: "application/vnd.github.raw+json" }
              });
              if (blobResp && blobResp.ok) {
                const blobBytes = await streamResponseToUint8Array(blobResp, fileIndex);
                const probeText = (() => {
                  try {
                    return new TextDecoder().decode(blobBytes.slice(0, 256));
                  } catch {
                    return "";
                  }
                })();

                if (probeText.startsWith("version https://git-lfs.github.com/spec/v1")) {
                  const oidMatch = probeText.match(/oid sha256:([a-f0-9]{64})/i);
                  const sizeMatch = probeText.match(/size (\d+)/i);
                  const oid = oidMatch ? oidMatch[1] : "";
                  const size = sizeMatch ? Number(sizeMatch[1]) : (fileMeta.size || 0);
                  console.info("LFS: pointer detected via raw blob API for", fileMeta.path, { oid, size });

                  try {
                    const mediaUrl = owner && repo && branch
                      ? "https://media.githubusercontent.com/media/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + encodeURIComponent(branch) + "/" + fileMeta.path.split("/").map(encodeURIComponent).join("/")
                      : null;
                    if (mediaUrl) {
                      console.debug("LFS: attempting media.githubusercontent.com fallback", mediaUrl);
                      const mediaResp = await fetch(mediaUrl, { cache: "no-store", redirect: "follow" });
                      if (mediaResp && mediaResp.ok) {
                        const mediaLength = Number(mediaResp.headers.get("content-length")) || size || 0;
                        if (mediaLength > 0) {
                          adjustTotalForActualSize(mediaLength, fileMeta.size);
                          ensureTotalAtLeast(downloadedBytes + mediaLength);
                          updateProgress(fileIndex);
                        }
                        const mediaBytes = await streamResponseToUint8Array(mediaResp, fileIndex);
                        console.info("LFS: media.githubusercontent.com returned object for", fileMeta.path);
                        ensureTotalAtLeast(downloadedBytes);
                        updateProgress(fileIndex);
                        return mediaBytes;
                      }
                    }
                  } catch (mediaErr) {
                    console.debug("LFS: media fallback failed", mediaErr);
                  }

                  const batchJson = JSON.stringify({ operation: "download", objects: [{ oid, size }] });
                  const curlCmd = "curl -s -X POST 'https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + ".git/info/lfs/objects/batch' -H 'Accept: application/vnd.git-lfs+json' -H 'Content-Type: application/json' -d '" + batchJson.replace(/'/g, "'\\''") + "'" + " | jq -r '.objects[0].actions.download.href'";
                  throw new Error(
                    "Git LFS pointer detected for '" + fileMeta.path + "' (oid=" + oid + ", size=" + size + ").\n" +
                    "CORS prevents the browser from calling the Git LFS batch API.\n" +
                    "You can run this command locally to get the presigned download URL:\n" +
                    curlCmd
                  );
                }

                // Non-LFS raw blob: this is the true file bytes. Avoid the extra raw.githubusercontent.com fetch.
                return blobBytes;
              }
            } catch (e) {
              // ignore API errors and fall back to raw fetch
            }
          }

          const res = await fetch(rawUrl, { cache: "no-store" });
          const rateLimitErr = checkGithubResponseRateLimit(res);
          if (rateLimitErr) {
            throw rateLimitErr;
          }
          if (!res.ok) {
            throw new Error("HTTP " + res.status + " for " + fileMeta.path);
          }
          if (res.body && typeof res.body.getReader === "function") {
            const reader = res.body.getReader();
            // Probe the first chunk to detect LFS pointer
            const firstRead = await reader.read();
            if (firstRead && !firstRead.done && firstRead.value) {
              try {
                const probeBytes = firstRead.value;
                const contentType = String(res.headers.get("content-type") || "").toLowerCase();
                if (contentType.includes("text") || contentType.includes("application/octet-stream") || contentType.includes("application/x-git-lfs")) {
                  const probeText = (() => {
                    try { return new TextDecoder().decode(probeBytes); } catch { return ""; }
                  })();
                  if (probeText.startsWith("version https://git-lfs.github.com/spec/v1")) {
                    // Parse pointer
                    const oidMatch = probeText.match(/oid sha256:([a-f0-9]{64})/i);
                    const sizeMatch = probeText.match(/size (\d+)/i);
                    if (oidMatch) {
                      const oid = oidMatch[1];
                      const size = sizeMatch ? Number(sizeMatch[1]) : 0;
                      console.info("LFS: detected pointer in repo file", fileMeta.path, { oid, size });
                      if (size > 0) {
                        adjustTotalForActualSize(size, fileMeta.size);
                        ensureTotalAtLeast(downloadedBytes + size);
                        updateProgress(fileIndex);
                      }

                      // derive owner/repo/branch from snapshot
                      const rawUrl = owner && repo && branch
                        ? "https://raw.githubusercontent.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + encodeURIComponent(branch) + "/" + fileMeta.path.split("/").map(encodeURIComponent).join("/")
                        : null;
                      if (rawUrl) {
                        // Try media.githubusercontent.com before calling batch API (some media URLs serve real object)
                        try {
                          const mediaUrl = "https://media.githubusercontent.com/media/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + encodeURIComponent(branch) + "/" + fileMeta.path.split("/").map(encodeURIComponent).join("/");
                          console.debug("LFS: attempting media.githubusercontent.com fallback for repo file", mediaUrl);
                          const mediaResp = await fetch(mediaUrl, { cache: "no-store", redirect: "follow" });
                          if (mediaResp && mediaResp.ok) {
                            const mediaLength = Number(mediaResp.headers.get("content-length")) || size || 0;
                            if (mediaLength > 0) {
                              adjustTotalForActualSize(mediaLength, fileMeta.size);
                              ensureTotalAtLeast(downloadedBytes + mediaLength);
                              updateProgress(fileIndex);
                            }
                            const mediaBytes = await streamResponseToUint8Array(mediaResp, fileIndex);
                            console.info("LFS: media.githubusercontent.com returned object for repo file", fileMeta.path);
                            ensureTotalAtLeast(downloadedBytes);
                            updateProgress(fileIndex);
                            return mediaBytes;
                          }
                        } catch (mediaErr) {
                          console.debug("LFS: media fallback failed for repo file", mediaErr);
                        }

                        const batchUrl = "https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + ".git/info/lfs/objects/batch";
                        const batchBody = JSON.stringify({ operation: "download", objects: [{ oid, size }] });
                        try {
                          console.debug("LFS: calling batch API for repo file", batchUrl);
                          const batchResp = await fetch(batchUrl, {
                            method: "POST",
                            headers: { Accept: "application/vnd.git-lfs+json", "Content-Type": "application/json" },
                            body: batchBody
                          });
                          if (batchResp && batchResp.ok) {
                            const batchJson = await batchResp.json();
                            const actions = batchJson && batchJson.objects && batchJson.objects[0] && batchJson.objects[0].actions;
                            const downloadAction = actions && (actions.download || actions.get);
                            if (downloadAction && downloadAction.href) {
                              console.info("LFS: obtained download href for repo file", downloadAction.href);
                              const objResp = await fetch(downloadAction.href, { cache: "no-store", redirect: "follow" });
                              if (objResp && objResp.ok) {
                                const objBytes = await streamResponseToUint8Array(objResp, fileIndex);
                                adjustTotalForActualSize(objBytes.length, fileMeta.size);
                                ensureTotalAtLeast(downloadedBytes);
                                updateProgress(fileIndex);
                                return objBytes;
                              }
                            }
                          }
                        } catch (e) {
                          console.error("LFS batch/download failed for repo file", e);
                        }
                      }
                    }
                  }
                }
              } catch (e) {
                console.error("LFS probe error for", fileMeta.path, e);
              }
            }

            // No LFS pointer handling or failed — continue streaming including first chunk
            const chunks = [];
            let fileBytes = 0;
            if (firstRead && firstRead.value) {
              chunks.push(firstRead.value);
              fileBytes += firstRead.value.byteLength || firstRead.value.length || 0;
              downloadedBytes += firstRead.value.byteLength || firstRead.value.length || 0;
              updateProgress(fileIndex);
            }
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              if (value) {
                chunks.push(value);
                fileBytes += value.byteLength;
                downloadedBytes += value.byteLength;
                updateProgress(fileIndex);
              }
            }
            const out = new Uint8Array(fileBytes);
            let offset = 0;
            for (const chunk of chunks) {
              out.set(chunk, offset);
              offset += chunk.byteLength;
            }
            return out;
          }
          const buf = await res.arrayBuffer();
          downloadedBytes += buf.byteLength;
          updateProgress(fileIndex);
          return new Uint8Array(buf);
        } catch (err) {
          lastError = err;
          if (isGithubRateLimitError(err)) {
            throw err;
          }
          // undo any bytes counted before the retry
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 300 * attempt));
          }
        }
      }
      throw lastError || new Error("Failed to download file " + fileMeta.path);
    };

    for (let i = 0; i < files.length; i += 1) {
      const fileMeta = files[i];
      setWorkProgressTree(i, files.length, fileMeta.path);
      const bytes = await fetchBytesStreaming(fileMeta, i);
      if (onFile) {
        try {
          await onFile(fileMeta, bytes, i);
        } catch (e) {
          // ensure failures in a user callback don't break the overall download loop
          console.error('onFile callback failed for', fileMeta.path, e);
        }
      } else {
        entries.push({
          path: fileMeta.path,
          bytes
        });
      }
      setWorkProgressTree(i + 1, files.length, fileMeta.path);
    }
    setWorkProgressTree(files.length, files.length, "");
    return entries;
  }

async function downloadGithubRepoSnapshotZip(snapshot, label) {
    return buildZipFileFromGithubTree(snapshot, label || "Downloading repo files");
  }

async function downloadGithubReleaseZip(sourceMeta, label) {
    const source = sourceMeta && typeof sourceMeta === "object" ? sourceMeta : null;
    const primaryUrl = toHttpUrl(source && source.downloadUrl ? source.downloadUrl : "");
    let primaryError = null;
    if (primaryUrl) {
      try {
        return await downloadZipFromUrl(primaryUrl, label);
      } catch (error) {
        primaryError = error;
        console.error(error);
      }
    }
    const owner = String(source && source.owner || "").trim();
    const repo = String(source && source.repo || "").trim();
    const assetId = Number(source && source.assetId) || 0;
    if (!owner || !repo || !assetId) {
      throw primaryError || new Error("Release ZIP download failed and no api.github.com asset id is available.");
    }
    log("Direct github.com download failed; retrying release asset via api.github.com...");
    const apiUrl =
      "https://api.github.com/repos/" +
      encodeURIComponent(owner) + "/" +
      encodeURIComponent(repo) +
      "/releases/assets/" +
      encodeURIComponent(String(assetId));
    return downloadZipFromUrl(apiUrl, label, {
      headers: {
        Accept: "application/octet-stream",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      skipHead: true,
      fileNameHint: String(source.assetName || "") || (repo + "-release.zip")
    });
  }

async function fetchZipHeadInfo(url, options) {
    const opts = options && typeof options === "object" ? options : {};
    const normalizedUrl = toHttpUrl(url);
    if (!normalizedUrl) {
      throw new Error("Invalid ZIP URL.");
    }
    const headers = opts.headers && typeof opts.headers === "object" ? opts.headers : undefined;
    const response = await fetch(normalizedUrl, {
      method: "HEAD",
      cache: "no-store",
      headers
    });
    if (!response.ok) {
      throw new Error("HEAD request failed (" + response.status + ").");
    }
    return {
      url: toHttpUrl(response.url || normalizedUrl) || normalizedUrl,
      etag: normalizeHttpHeaderToken(response.headers.get("etag") || ""),
      lastModified: normalizeHttpHeaderToken(response.headers.get("last-modified") || ""),
      contentLength: Number(response.headers.get("content-length")) || 0
    };
  }

async function downloadZipFromUrl(url, label, options) {
    const opts = options && typeof options === "object" ? options : {};
    const normalizedUrl = toHttpUrl(url);
    if (!normalizedUrl) {
      throw new Error("Invalid ZIP URL.");
    }
    const requestHeaders = opts.headers && typeof opts.headers === "object" ? opts.headers : undefined;
    let expectedTotal = 0;
    if (!opts.skipHead) {
      try {
        const head = await fetchZipHeadInfo(normalizedUrl, { headers: requestHeaders });
        expectedTotal = Number(head.contentLength) || 0;
      } catch {
        expectedTotal = 0;
      }
    }
    const response = await fetch(normalizedUrl, {
      cache: "no-store",
      headers: requestHeaders,
      redirect: "follow"
    });
    if (!response.ok) {
      throw new Error("Download failed (" + response.status + ").");
    }
    const contentLength = Number(response.headers.get("content-length")) || 0;
    const total = contentLength || expectedTotal;
    const fileNameHint = String(opts.fileNameHint || "").trim();
    const reader = response.body && typeof response.body.getReader === "function"
      ? response.body.getReader()
      : null;
    // Try LFS pointer handling before streaming the whole response
    if (reader) {
      const lfsResult = await tryHandleLfsPointer();
      if (lfsResult && lfsResult.file) {
        // We obtained the real object packaged as a file/zip
        return lfsResult;
      }
      var probeChunk = lfsResult && lfsResult.probeChunk ? lfsResult.probeChunk : null;
    }
    // Detect Git LFS pointer files served from raw.githubusercontent.com and
    // automatically fetch the real object via the Git LFS batch API when possible.
    async function tryHandleLfsPointer() {
      try {
        console.debug("LFS: trying to detect pointer for", normalizedUrl);
        // Only attempt when response looks textual or small
        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        if (!contentType.includes("text") && !contentType.includes("application/octet-stream") && !contentType.includes("application/x-git-lfs")) {
          console.debug("LFS: skipping due to content-type", contentType);
          return null;
        }
        // Read a small prefix to detect pointer
        const probe = reader ? await reader.read() : null;
        if (!probe || probe.done || !probe.value) {
          if (probe && probe.done) {
            console.debug("LFS: stream ended before probe");
            return null;
          }
          console.debug("LFS: no probe data available");
          return null;
        }
        const firstBytes = probe.value;
        const text = (() => {
          try {
            return new TextDecoder().decode(firstBytes);
          } catch (e) {
            console.debug("LFS: decode error", e && e.message);
            return "";
          }
        })();
        if (!text.startsWith("version https://git-lfs.github.com/spec/v1")) {
          // Not an LFS pointer, push the chunk back to stream by returning it
          console.debug("LFS: not a pointer; first bytes:", text.slice(0, 200));
          return { probeChunk: firstBytes };
        }

        // Parse pointer
        const oidMatch = text.match(/oid sha256:([a-f0-9]{64})/i);
        const sizeMatch = text.match(/size (\d+)/i);
        if (!oidMatch) {
          console.debug("LFS: pointer missing oid");
          return null;
        }
        const oid = oidMatch[1];
        const size = sizeMatch ? Number(sizeMatch[1]) : 0;
        console.info("LFS: detected pointer", { oid, size });

        // Attempt to extract owner/repo from raw.githubusercontent.com URL
        const rawMatch = normalizedUrl.match(/^https?:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)$/i);
        if (!rawMatch) {
          console.debug("LFS: could not parse owner/repo from URL");
          return null;
        }
        const owner = rawMatch[1];
        const repo = rawMatch[2];
        const branch = rawMatch[3];

        const branchUrl = owner && repo && branch
          ? "https://media.githubusercontent.com/media/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/" + encodeURIComponent(branch) + "/" + normalizedUrl.split("/").slice(5).map(encodeURIComponent).join("/")
          : null;
        if (branchUrl) {
          try {
            console.debug("LFS: attempting media.githubusercontent.com fallback for direct URL", branchUrl);
            const mediaResp = await fetch(branchUrl, { cache: "no-store", redirect: "follow" });
            if (mediaResp && mediaResp.ok) {
              const mediaSize = Number(mediaResp.headers.get("content-length")) || size || 1;
              setWorkProgress("Downloading LFS object", 0, mediaSize);
              const mediaBuf = await mediaResp.arrayBuffer();
              console.info("LFS: media.githubusercontent.com returned object for direct URL");
              const mediaBytes = new Uint8Array(mediaBuf);
              if (mediaBytes.length > size) {
                setWorkProgress("Downloading LFS object", mediaBytes.length, mediaSize);
              }
              const pathParts = normalizedUrl.split("/");
              const fileName = pathParts[pathParts.length - 1] || (oid + ".bin");
              if (mediaBytes.length >= 4 && mediaBytes[0] === 0x50 && mediaBytes[1] === 0x4b && mediaBytes[2] === 0x03 && mediaBytes[3] === 0x04) {
                return {
                  file: new File([mediaBytes], fileName, { type: "application/zip" }),
                  resolvedUrl: branchUrl,
                  etag: normalizeHttpHeaderToken(mediaResp.headers.get("etag") || ""),
                  lastModified: normalizeHttpHeaderToken(mediaResp.headers.get("last-modified") || "")
                };
              }
              const zipBytes = createZipStoreArchive([{ path: fileName, bytes: mediaBytes }]);
              return {
                file: new File([zipBytes], fileName + ".zip", { type: "application/zip" }),
                resolvedUrl: branchUrl,
                etag: normalizeHttpHeaderToken(mediaResp.headers.get("etag") || ""),
                lastModified: normalizeHttpHeaderToken(mediaResp.headers.get("last-modified") || "")
              };
            }
          } catch (mediaErr) {
            console.debug("LFS: direct media fallback failed", mediaErr);
          }
        }

        const batchUrl = "https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + ".git/info/lfs/objects/batch";
        const batchBody = JSON.stringify({ operation: "download", objects: [{ oid, size }] });
        console.debug("LFS: calling batch API", batchUrl);
        const batchResp = await fetch(batchUrl, {
          method: "POST",
          headers: {
            Accept: "application/vnd.git-lfs+json",
            "Content-Type": "application/json"
          },
          body: batchBody
        });
        if (!batchResp.ok) {
          console.debug("LFS: batch API failed", batchResp.status);
          return null;
        }
        const batchJson = await batchResp.json();
        const actions = batchJson && batchJson.objects && batchJson.objects[0] && batchJson.objects[0].actions;
        const downloadAction = actions && (actions.download || actions.get);
        if (!downloadAction || !downloadAction.href) {
          console.debug("LFS: no download action in batch response");
          return null;
        }
        const downloadHref = downloadAction.href;
        console.info("LFS: obtained download href", downloadHref);

        const objResp = await fetch(downloadHref, { cache: "no-store", redirect: "follow" });
        if (!objResp.ok) throw new Error("LFS object download failed (" + objResp.status + ")");
        const objSize = Number(objResp.headers.get("content-length")) || size || 1;
        setWorkProgress("Downloading LFS object", 0, objSize);
        const objBuf = await objResp.arrayBuffer();
        const objBytes = new Uint8Array(objBuf);

        if (objBytes.length !== objSize) {
          setWorkProgress("Downloading LFS object", objBytes.length, objSize);
        }

        // Determine filename from original path
        const pathParts = normalizedUrl.split("/");
        const fileName = pathParts[pathParts.length - 1] || (oid + ".bin");

        // If the object is already a ZIP, return it; otherwise package into a ZIP
        if (objBytes.length >= 4 && objBytes[0] === 0x50 && objBytes[1] === 0x4b && objBytes[2] === 0x03 && objBytes[3] === 0x04) {
          console.info("LFS: downloaded zip object, returning as zip");
          return {
            file: new File([objBytes], fileName, { type: "application/zip" }),
            resolvedUrl: downloadHref,
            etag: normalizeHttpHeaderToken(objResp.headers.get("etag") || ""),
            lastModified: normalizeHttpHeaderToken(objResp.headers.get("last-modified") || "")
          };
        }

        // Create a simple zip with the single file using createZipStoreArchive
        console.info("LFS: wrapping object into zip", fileName);
        const zipBytes = createZipStoreArchive([{ path: fileName, bytes: objBytes }]);
        const zipFile = new File([zipBytes], fileName + ".zip", { type: "application/zip" });
        return { file: zipFile, resolvedUrl: downloadHref, etag: normalizeHttpHeaderToken(objResp.headers.get("etag") || ""), lastModified: normalizeHttpHeaderToken(objResp.headers.get("last-modified") || "") };
      } catch (error) {
        // If anything fails, don't block normal download flow
        console.error("LFS detection/fetch failed:", error);
        return null;
      }
    }
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      setWorkProgress(label || "Downloading ZIP", bytes.byteLength, bytes.byteLength || 1);
      let fileName = extractZipFileNameFromResponse(response, normalizedUrl);
      if (fileNameHint && (!fileName || fileName === "download.zip" || !/\.zip$/i.test(fileName))) {
        fileName = fileNameHint;
      }
      const outName = /\.zip$/i.test(fileName) ? fileName : (fileName + ".zip");
      return {
        file: new File([bytes], outName, { type: "application/zip" }),
        resolvedUrl: toHttpUrl(response.url || normalizedUrl) || normalizedUrl,
        etag: normalizeHttpHeaderToken(response.headers.get("etag") || ""),
        lastModified: normalizeHttpHeaderToken(response.headers.get("last-modified") || "")
      };
    }

    let loaded = 0;
    let lastReported = 0;
    const chunks = [];
    if (probeChunk) {
      chunks.push(probeChunk);
      loaded += probeChunk.byteLength || probeChunk.length || 0;
    }
    setWorkProgress(label || "Downloading ZIP", 0, total > 0 ? total : 0);
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
      if (loaded - lastReported >= 262144 || (total > 0 && loaded >= total)) {
        if (total > 0) {
          setWorkProgress(label || "Downloading ZIP", loaded, total);
        } else {
          setWorkProgress((label || "Downloading ZIP") + " (" + formatBytes(loaded) + ")", 0, 0);
        }
        lastReported = loaded;
      }
    }
    if (total > 0) {
      setWorkProgress(label || "Downloading ZIP", loaded, total);
    } else {
      setWorkProgress(label || "Download complete", loaded || 1, loaded || 1);
    }
    const blob = new Blob(chunks, { type: "application/zip" });
    let fileName = extractZipFileNameFromResponse(response, normalizedUrl);
    if (fileNameHint && (!fileName || fileName === "download.zip" || !/\.zip$/i.test(fileName))) {
      fileName = fileNameHint;
    }
    const outName = /\.zip$/i.test(fileName) ? fileName : (fileName + ".zip");
    return {
      file: new File([blob], outName, { type: "application/zip" }),
      resolvedUrl: toHttpUrl(response.url || normalizedUrl) || normalizedUrl,
      etag: normalizeHttpHeaderToken(response.headers.get("etag") || ""),
      lastModified: normalizeHttpHeaderToken(response.headers.get("last-modified") || "")
    };
  }

function githubReleaseHasUpdate(previousSource, latestSource) {
    const prev = normalizeGithubSource(previousSource);
    const next = normalizeGithubSource(latestSource);
    if (!prev || !next || prev.provider !== "github-release" || next.provider !== "github-release") {
      return false;
    }
    if (prev.assetId && next.assetId) {
      return prev.assetId !== next.assetId;
    }
    if (prev.releaseTag && next.releaseTag) {
      return prev.releaseTag !== next.releaseTag;
    }
    if (prev.assetUpdatedAt && next.assetUpdatedAt) {
      return next.assetUpdatedAt > prev.assetUpdatedAt;
    }
    return prev.downloadUrl !== next.downloadUrl;
  }

function zipUrlHasUpdate(previousSource, remoteHeadInfo) {
    const prev = normalizeGithubSource(previousSource);
    if (!prev || prev.provider !== "zip-url") {
      return false;
    }
    const nextEtag = normalizeHttpHeaderToken(remoteHeadInfo && remoteHeadInfo.etag ? remoteHeadInfo.etag : "");
    const nextLastModified = normalizeHttpHeaderToken(remoteHeadInfo && remoteHeadInfo.lastModified ? remoteHeadInfo.lastModified : "");
    if (prev.etag && nextEtag) {
      return prev.etag !== nextEtag;
    }
    if (prev.lastModified && nextLastModified) {
      return prev.lastModified !== nextLastModified;
    }
    return false;
  }
