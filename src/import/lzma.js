async function inflateLZMA(data, options) {
  const reportProgress = !(options && options.reportProgress === false);
  if (reportProgress) setWorkProgress("Inflating LZMA Data", 0, 0);
  console.log("[LZMA] Starting decompression. Input size:", data.length);

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  // --- Parse the zip-style LZMA entry header: 2 bytes SDK version, 2 bytes props size (LE), then props ---
  if (bytes.length < 4) {
    throw new Error("LZMA entry too short to contain header");
  }
  const propsSize = bytes[2] | (bytes[3] << 8);
  if (4 + propsSize > bytes.length) {
    throw new Error("LZMA header is truncated");
  }
  if (propsSize < 1) {
    throw new Error("LZMA properties missing");
  }

  const propsByte = bytes[4];
  let d = propsByte;
  const lc = d % 9;
  d = (d / 9) | 0;
  const lp = d % 5;
  const pb = (d / 5) | 0;
  if (lc > 8 || lp > 4 || pb > 4) {
    throw new Error("Invalid LZMA properties byte: " + propsByte);
  }
  console.log("[LZMA] lc:", lc, "lp:", lp, "pb:", pb);

  const posStateMask = (1 << pb) - 1;
  const literalPosMask = (1 << lp) - 1;

  // --- Input stream cursor (starts right after the header/props) ---
  let inPos = 4 + propsSize;
  const readByte = () => (inPos < bytes.length ? bytes[inPos++] : 0);

  // --- Range decoder state ---
  let Code = 0;
  let Range = 0xFFFFFFFF;

  readByte(); // mandatory leading 0 byte
  for (let i = 0; i < 4; i++) {
    Code = ((Code << 8) | readByte()) >>> 0;
  }

  function normalize() {
    if (Range < 0x1000000) {
      Code = ((Code << 8) | readByte()) >>> 0;
      Range = (Range << 8) >>> 0;
    }
  }

  function decodeBit(probs, index) {
    const prob = probs[index];
    const bound = (Range >>> 11) * prob;
    let bit;
    if (Code >>> 0 < bound) {
      Range = bound;
      probs[index] = prob + ((2048 - prob) >>> 5);
      bit = 0;
    } else {
      Range = (Range - bound) >>> 0;
      Code = (Code - bound) >>> 0;
      probs[index] = prob - (prob >>> 5);
      bit = 1;
    }
    normalize();
    return bit;
  }

  function decodeDirectBits(numBits) {
    let result = 0;
    for (let i = 0; i < numBits; i++) {
      Range = Range >>> 1;
      Code = (Code - Range) >>> 0;
      const t = (0 - (Code >>> 31)) >>> 0;
      Code = (Code + (Range & t)) >>> 0;
      result = ((result << 1) + ((t + 1) >>> 0)) >>> 0;
      normalize();
    }
    return result >>> 0;
  }

  function bitTreeDecode(probs, numBits) {
    let m = 1;
    for (let i = 0; i < numBits; i++) {
      m = (m << 1) + decodeBit(probs, m);
    }
    return m - (1 << numBits);
  }

  function bitTreeReverseDecode(probs, offset, numBits) {
    let m = 1;
    let symbol = 0;
    for (let i = 0; i < numBits; i++) {
      const bit = decodeBit(probs, offset + m);
      m = (m << 1) + bit;
      symbol |= bit << i;
    }
    return symbol;
  }

  const newProbs = (n) => new Uint16Array(n).fill(1024);

  const isMatch = newProbs(12 << 4);
  const isRep = newProbs(12);
  const isRepG0 = newProbs(12);
  const isRepG1 = newProbs(12);
  const isRepG2 = newProbs(12);
  const isRep0Long = newProbs(12 << 4);
  const posSlotDecoders = [newProbs(64), newProbs(64), newProbs(64), newProbs(64)];
  const posDecoders = newProbs(115);
  const posAlignDecoder = newProbs(16);

  function makeLenDecoder() {
    return {
      choice: newProbs(2),
      low: Array.from({ length: 16 }, () => newProbs(8)),
      mid: Array.from({ length: 16 }, () => newProbs(8)),
      high: newProbs(256),
    };
  }
  const lenDecoder = makeLenDecoder();
  const repLenDecoder = makeLenDecoder();

  function decodeLen(ld, posState) {
    if (!decodeBit(ld.choice, 0)) {
      return bitTreeDecode(ld.low[posState], 3);
    }
    if (!decodeBit(ld.choice, 1)) {
      return 8 + bitTreeDecode(ld.mid[posState], 3);
    }
    return 16 + bitTreeDecode(ld.high, 8);
  }

  const numLiteralStates = 1 << (lc + lp);
  const literalProbs = Array.from({ length: numLiteralStates }, () => newProbs(0x300));

  function literalDecoderIndex(pos, prevByte) {
    return ((pos & literalPosMask) << lc) + ((prevByte & 0xff) >>> (8 - lc));
  }

  function decodeLiteralNormal(probs) {
    let symbol = 1;
    do {
      symbol = (symbol << 1) | decodeBit(probs, symbol);
    } while (symbol < 0x100);
    return symbol & 0xff;
  }

  function decodeLiteralMatched(probs, matchByteIn) {
    let symbol = 1;
    let matchByte = matchByteIn;
    do {
      const matchBit = (matchByte >> 7) & 1;
      matchByte = (matchByte << 1) & 0xff;
      const bit = decodeBit(probs, ((1 + matchBit) << 8) + symbol);
      symbol = (symbol << 1) | bit;
      if (matchBit !== bit) {
        while (symbol < 0x100) {
          symbol = (symbol << 1) | decodeBit(probs, symbol);
        }
        break;
      }
    } while (symbol < 0x100);
    return symbol & 0xff;
  }

  function getLenToPosState(len) {
    len -= 2;
    return len < 4 ? len : 3;
  }

  // --- Growable output buffer (size unknown up front) ---
  let out = new Uint8Array(Math.max(bytes.length * 4, 4096));
  let outPos = 0;
  function ensureCapacity(extra) {
    if (outPos + extra > out.length) {
      let newLen = out.length * 2;
      while (newLen < outPos + extra) newLen *= 2;
      const old = out;
      out = new Uint8Array(newLen);
      out.set(old);
    }
  }

  let state = 0;
  let rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;
  let prevByte = 0;
  let iterations = 0;
  let start = Date.now();

  // Stop when we've consumed the whole compressed buffer (with a little slack for
  // the decoder's internal lookahead) or when we hit the explicit end marker.
  while (inPos < bytes.length + 4) {
    iterations++;
    if (iterations % 4096 === 0) {
      const now = Date.now();
      if (now - start > 200) {
        console.log(`[LZMA] Progress: ${outPos} bytes decoded, inPos ${inPos}/${bytes.length}`);
        if (reportProgress) setWorkProgress("Inflating LZMA Data VS JS", inPos, bytes.length);
        await new Promise((resolve) => setTimeout(resolve, 0));
        start = Date.now();
      }
    }
    if (iterations > 50_000_000) {
      throw new Error("LZMA decode exceeded safety iteration limit — stream likely corrupt");
    }

    const posState = outPos & posStateMask;
    ensureCapacity(1);

    if (!decodeBit(isMatch, (state << 4) + posState)) {
      const probs = literalProbs[literalDecoderIndex(outPos, prevByte)];
      prevByte = state < 7
        ? decodeLiteralNormal(probs)
        : decodeLiteralMatched(probs, out[outPos - rep0 - 1]);
      out[outPos++] = prevByte;
      state = state < 4 ? 0 : (state < 10 ? state - 3 : state - 6);
      continue;
    }

    let len;
    if (decodeBit(isRep, state)) {
      if (!decodeBit(isRepG0, state)) {
        if (!decodeBit(isRep0Long, (state << 4) + posState)) {
          state = state < 7 ? 9 : 11;
          prevByte = out[outPos - rep0 - 1];
          out[outPos++] = prevByte;
          continue;
        }
      } else {
        let distance;
        if (!decodeBit(isRepG1, state)) {
          distance = rep1;
        } else {
          if (!decodeBit(isRepG2, state)) {
            distance = rep2;
          } else {
            distance = rep3;
            rep3 = rep2;
          }
          rep2 = rep1;
        }
        rep1 = rep0;
        rep0 = distance;
      }
      len = decodeLen(repLenDecoder, posState) + 2;
      state = state < 7 ? 8 : 11;
    } else {
      rep3 = rep2;
      rep2 = rep1;
      rep1 = rep0;
      len = 2 + decodeLen(lenDecoder, posState);
      state = state < 7 ? 7 : 10;

      const posSlot = bitTreeDecode(posSlotDecoders[getLenToPosState(len)], 6);
      if (posSlot < 4) {
        rep0 = posSlot;
      } else {
        const numDirectBits = (posSlot >> 1) - 1;
        rep0 = (2 | (posSlot & 1)) << numDirectBits;
        if (posSlot < 14) {
          rep0 += bitTreeReverseDecode(posDecoders, rep0 - posSlot - 1, numDirectBits);
        } else {
          rep0 = (rep0 + (decodeDirectBits(numDirectBits - 4) << 4)) >>> 0;
          rep0 += bitTreeReverseDecode(posAlignDecoder, 0, 4);
          if (rep0 >>> 0 === 0xFFFFFFFF) {
            console.log("[LZMA] End marker reached at", outPos, "bytes");
            return out.subarray(0, outPos);
          }
        }
      }
    }

    if (rep0 >= outPos || rep0 < 0) {
      throw new Error("LZMA stream corrupted: invalid match distance");
    }

    ensureCapacity(len);
    let srcPos = outPos - rep0 - 1;
    for (let i = 0; i < len; i++) {
      out[outPos] = out[srcPos];
      outPos++;
      srcPos++;
    }
    prevByte = out[outPos - 1];
  }

  console.log("[LZMA] Ran out of input without an end marker. Output size:", outPos);
  return out.subarray(0, outPos);
}