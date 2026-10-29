const ECC = {
  1: { data: 19, ecc: 7, blocks: 1 },
  2: { data: 34, ecc: 10, blocks: 1 },
  3: { data: 55, ecc: 15, blocks: 1 },
  4: { data: 80, ecc: 20, blocks: 1 },
  5: { data: 108, ecc: 26, blocks: 1 },
  6: { data: 136, ecc: 18, blocks: 2 }
};
const ALIGNMENT = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

function multiply(a, b) {
  let result = 0;
  while (b) {
    if (b & 1) result ^= a;
    b >>>= 1;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return result;
}
function generatorPolynomial(degree) {
  let polynomial = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = new Array(polynomial.length + 1).fill(0);
    for (let j = 0; j < polynomial.length; j++) {
      next[j] ^= polynomial[j];
      next[j + 1] ^= multiply(polynomial[j], root);
    }
    polynomial = next;
    root = multiply(root, 2);
  }
  return polynomial;
}
function errorCorrection(data, count) {
  const generator = generatorPolynomial(count);
  const remainder = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let j = 0; j < count; j++) remainder[j] ^= multiply(generator[j + 1], factor);
  }
  return remainder;
}
function dataWords(bytes, version) {
  const capacity = ECC[version].data * 8;
  const bits = [];
  const append = (value, count) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, 8);
  for (const byte of bytes) append(byte, 8);
  for (let i = 0; i < Math.min(4, capacity - bits.length); i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const result = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    result.push(byte);
  }
  let pad = 0;
  while (result.length < ECC[version].data) {
    result.push(pad++ % 2 === 0 ? 0xec : 0x11);
  }
  return result;
}
function allCodewords(data, version) {
  const config = ECC[version];
  if (config.blocks === 1) return data.concat(errorCorrection(data, config.ecc));
  const dataBlocks = [data.slice(0, 68), data.slice(68, 136)];
  const eccBlocks = dataBlocks.map(block => errorCorrection(block, config.ecc));
  const out = [];
  for (let i = 0; i < 68; i++) for (const block of dataBlocks) out.push(block[i]);
  for (let i = 0; i < config.ecc; i++) for (const block of eccBlocks) out.push(block[i]);
  return out;
}
function appendBits(bits, value, count) {
  for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}
function bchFormat(value) {
  let remainder = value << 10;
  const generator = 0x537;
  for (let bit = 14; bit >= 10; bit--) {
    if (((remainder >>> bit) & 1) !== 0) remainder ^= generator << (bit - 10);
  }
  return ((value << 10) | remainder) ^ 0x5412;
}
export function createQrMatrix(value) {
  const bytes = Array.from(new TextEncoder().encode(String(value)));
  let version = 0;
  for (let candidate = 1; candidate <= 6; candidate++) {
    if (4 + 8 + bytes.length * 8 <= ECC[candidate].data * 8) {
      version = candidate;
      break;
    }
  }
  if (!version) throw new Error("Il link è troppo lungo per essere codificato in questo QR.");
  const data = dataWords(bytes, version);
  const codewords = allCodewords(data, version);
  const size = 17 + version * 4;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const functional = Array.from({ length: size }, () => new Array(size).fill(false));
  const put = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    matrix[y][x] = Boolean(dark);
    functional[y][x] = true;
  };
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      put(cx + dx, cy + dy, distance !== 4 && (distance === 3 || distance <= 1));
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  for (let i = 8; i < size - 8; i++) {
    put(i, 6, i % 2 === 0);
    put(6, i, i % 2 === 0);
  }
  const points = ALIGNMENT[version];
  for (const cy of points) for (const cx of points) {
    if ((cx === 6 && cy === 6) || (cx === size - 7 && cy === 6) || (cx === 6 && cy === size - 7)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      put(cx + dx, cy + dy, d !== 1);
    }
  }
  // Reserve format-information cells so data placement skips them.
  for (let i = 0; i <= 5; i++) put(8, i, false);
  put(8, 7, false);
  put(8, 8, false);
  put(7, 8, false);
  for (let i = 9; i <= 14; i++) put(14 - i, 8, false);
  for (let i = 0; i <= 7; i++) put(size - 1 - i, 8, false);
  for (let i = 8; i <= 14; i++) put(8, size - 15 + i, false);
  put(8, size - 8, true);

  const bits = [];
  for (const byte of codewords) appendBits(bits, byte, 8);
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      const y = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset;
        if (functional[y][x]) continue;
        matrix[y][x] = bitIndex < bits.length ? bits[bitIndex++] === 1 : false;
      }
    }
    upward = !upward;
  }
  // Mask 0 (L-level QR format bits are written below).
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!functional[y][x] && (x + y) % 2 === 0) matrix[y][x] = !matrix[y][x];
  }
  const format = bchFormat((0b01 << 3) | 0);
  for (let i = 0; i <= 5; i++) put(8, i, ((format >>> i) & 1) !== 0);
  put(8, 7, ((format >>> 6) & 1) !== 0);
  put(8, 8, ((format >>> 7) & 1) !== 0);
  put(7, 8, ((format >>> 8) & 1) !== 0);
  for (let i = 9; i <= 14; i++) put(14 - i, 8, ((format >>> i) & 1) !== 0);
  for (let i = 0; i <= 7; i++) put(size - 1 - i, 8, ((format >>> i) & 1) !== 0);
  for (let i = 8; i <= 14; i++) put(8, size - 15 + i, ((format >>> i) & 1) !== 0);
  put(8, size - 8, true);
  return matrix.map(row => row.map(Boolean));
}
export function qrSvgSource(value, scale = 8, margin = 4) {
  const matrix = createQrMatrix(value);
  const size = matrix.length;
  const total = size + margin * 2;
  let path = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (matrix[y][x]) path += "M" + (x + margin) + " " + (y + margin) + "h1v1h-1z";
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + (total * scale) + '" height="' + (total * scale) + '" viewBox="0 0 ' + total + " " + total + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + path + '" fill="#111"/></svg>';
}