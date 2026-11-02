const DATA_CODEWORDS = [0, 19, 34, 55, 80, 108];
const ECC_CODEWORDS = [0, 7, 10, 15, 20, 26];

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisor(degree: number): number[] {
  const result = Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function remainder(data: number[], degree: number): number[] {
  const gen = divisor(degree);
  const result = [...data, ...Array<number>(degree).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const factor = result[i]!;
    for (let j = 0; j < gen.length; j++) result[i + j] ^= gfMultiply(gen[j]!, factor);
  }
  return result.slice(data.length);
}

function appendBits(target: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) target.push((value >>> i) & 1);
}

function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const capacity = DATA_CODEWORDS[version]!;
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);
  const maxBits = capacity * 8;
  for (let i = 0; i < Math.min(4, maxBits - bits.length); i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j]!;
    words.push(value);
  }
  for (let pad = 0; words.length < capacity; pad++) words.push(pad % 2 === 0 ? 0xec : 0x11);
  return words;
}

function setFunction(matrix: Array<Array<boolean | null>>, x: number, y: number, dark: boolean): void {
  if (y >= 0 && y < matrix.length && x >= 0 && x < matrix.length) matrix[y]![x] = dark;
}

function finder(matrix: Array<Array<boolean | null>>, centerX: number, centerY: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(matrix, centerX + dx, centerY + dy, distance !== 2 && distance !== 4);
    }
  }
}

function alignment(matrix: Array<Array<boolean | null>>, centerX: number, centerY: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(matrix, centerX + dx, centerY + dy, distance === 2 || distance === 0);
    }
  }
}

function formatBits(mask: number): number {
  const data = (0b01 << 3) | mask; // Error correction level L.
  let remainderBits = data << 10;
  for (let bit = 14; bit >= 10; bit--) {
    if (((remainderBits >>> bit) & 1) !== 0) remainderBits ^= 0x537 << (bit - 10);
  }
  return ((data << 10) | remainderBits) ^ 0x5412;
}

function drawFormat(matrix: Array<Array<boolean | null>>, mask: number): void {
  const size = matrix.length;
  const bits = formatBits(mask);
  for (let i = 0; i <= 5; i++) setFunction(matrix, 8, i, ((bits >>> i) & 1) !== 0);
  setFunction(matrix, 8, 7, ((bits >>> 6) & 1) !== 0);
  setFunction(matrix, 8, 8, ((bits >>> 7) & 1) !== 0);
  setFunction(matrix, 7, 8, ((bits >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i++) setFunction(matrix, 14 - i, 8, ((bits >>> i) & 1) !== 0);
  for (let i = 0; i < 8; i++) setFunction(matrix, size - 1 - i, 8, ((bits >>> i) & 1) !== 0);
  for (let i = 8; i < 15; i++) setFunction(matrix, 8, size - 15 + i, ((bits >>> i) & 1) !== 0);
  setFunction(matrix, 8, size - 8, true);
}

function buildMatrix(data: number[], version: number): boolean[][] {
  const size = 17 + version * 4;
  const matrix: Array<Array<boolean | null>> = Array.from({ length: size }, () => Array<boolean | null>(size).fill(null));
  finder(matrix, 3, 3);
  finder(matrix, size - 4, 3);
  finder(matrix, 3, size - 4);
  const centers = [6, 10 + 4 * version];
  for (const y of centers) {
    for (const x of centers) {
      if (matrix[y]?.[x] === null) alignment(matrix, x, y);
    }
  }
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6]![i] === null) setFunction(matrix, i, 6, i % 2 === 0);
    if (matrix[i]![6] === null) setFunction(matrix, 6, i, i % 2 === 0);
  }
  drawFormat(matrix, 0);
  const allBits: number[] = [];
  for (const word of data) appendBits(allBits, word, 8);
  const ecc = remainder(data, ECC_CODEWORDS[version]!);
  for (const word of ecc) appendBits(allBits, word, 8);

  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset;
        if (matrix[y]![x] !== null) continue;
        let dark = bitIndex < allBits.length && allBits[bitIndex] === 1;
        bitIndex++;
        if ((x + y) % 2 === 0) dark = !dark;
        matrix[y]![x] = dark;
      }
    }
    upward = !upward;
  }
  drawFormat(matrix, 0);
  return matrix.map((row) => row.map((value) => value === true));
}

export function qrMatrix(value: string): boolean[][] {
  const bytes = new TextEncoder().encode(value);
  const version = [1, 2, 3, 4, 5].find((candidate) => bytes.length <= (DATA_CODEWORDS[candidate]! - 2));
  if (!version) throw new Error("QR_VALUE_TOO_LONG");
  return buildMatrix(dataCodewords(bytes, version), version);
}

export function downloadQrSvg(value: string, filename = "vivarqo-qr.svg"): void {
  const matrix = qrMatrix(value);
  const quiet = 4;
  const size = matrix.length + quiet * 2;
  const paths: string[] = [];
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) paths.push("M" + (x + quiet) + " " + (y + quiet) + "h1v1h-1z");
  }));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + " " + size + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + paths.join("") + '" fill="#183a34"/></svg>';
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
