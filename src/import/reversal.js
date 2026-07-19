"use strict";

function decodeBytesAsUtf8(bytes) {
    if (typeof decodeUtf8 === "function") {
      return decodeUtf8(bytes);
    }
    return new TextDecoder().decode(bytes);
  }

function normalizeTransformationReplacements(transform) {
    if (!transform || !Array.isArray(transform.replacements)) {
      return [];
    }
    return transform.replacements
      .map((item) => ({
        original: typeof item.original === "string" ? item.original : "",
        transformed: typeof item.transformed === "string" ? item.transformed : ""
      }))
      .filter((item) => item.original && item.transformed && item.original !== item.transformed)
      .sort((a, b) => b.transformed.length - a.transformed.length);
  }

function replaceAllLiteral(text, from, to) {
    if (!from || !text.includes(from)) {
      return text;
    }
    return text.split(from).join(to);
  }

function revertJsonRewrite(bytes, transform) {
    const replacements = normalizeTransformationReplacements(transform);
    if (!replacements.length) {
      return bytes;
    }
    let text = decodeBytesAsUtf8(bytes);
    for (const replacement of replacements) {
      text = replaceAllLiteral(text, replacement.transformed, replacement.original);
    }
    return new TextEncoder().encode(text);
  }

function revertBrotliReplacement(bytes, transform) {
    return revertJsonRewrite(bytes, transform);
  }

function reverseFileTransformations(bytes, transformations) {
    let out = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!Array.isArray(transformations) || !transformations.length) {
      return out;
    }
    for (let index = transformations.length - 1; index >= 0; index -= 1) {
      const transform = transformations[index];
      if (!transform || typeof transform.type !== "string") {
        continue;
      }
      if (transform.type === "json_rewrite") {
        out = revertJsonRewrite(out, transform);
      } else if (transform.type === "brotli_replacement") {
        out = revertBrotliReplacement(out, transform);
      }
    }
    return out;
  }

function countReversibleTransformations(files) {
    return files.reduce((sum, file) => {
      const transforms = Array.isArray(file && file.transformations) ? file.transformations : [];
      return sum + transforms.filter((transform) => normalizeTransformationReplacements(transform).length > 0).length;
    }, 0);
  }
