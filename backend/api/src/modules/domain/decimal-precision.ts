/**
 * Decimal helpers for values stored with a fixed scale.
 *
 * JavaScript numbers are converted to their shortest round-trippable decimal
 * representation before inspecting the scale. This avoids testing precision
 * by multiplying a binary floating-point value (for example 1.001 * 1000).
 */
export function decimalScale(value: string | number): number | null {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!text) return null;
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return null;

  const fraction = (match[3] ?? match[4] ?? "").replace(/0+$/, "");
  const exponent = Number(match[5] ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;
  return Math.max(0, fraction.length - exponent);
}

export function hasMaximumDecimalPlaces(value: unknown, maximum: number): boolean {
  if (typeof value !== "number" && typeof value !== "string") return false;
  if (typeof value === "number" && !Number.isFinite(value)) return false;
  const scale = decimalScale(value);
  return scale !== null && scale <= maximum;
}

/** Convert a decimal to an integer at the requested scale without float math. */
export function decimalToScaledInteger(value: string | number, scale: number): number | null {
  if (!Number.isSafeInteger(scale) || scale < 0) return null;
  const text = typeof value === "number" ? String(value) : value.trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return null;

  const sign = match[1] === "-" ? -1n : 1n;
  const integer = match[2] ?? "0";
  const fraction = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;

  const digits = BigInt((integer + fraction).replace(/^0+(?=\d)/, "") || "0");
  const shift = scale + exponent - fraction.length;
  let scaled: bigint;
  if (shift >= 0) {
    scaled = digits * (10n ** BigInt(shift));
  } else {
    const divisor = 10n ** BigInt(-shift);
    if (digits % divisor !== 0n) return null;
    scaled = digits / divisor;
  }
  const result = sign * scaled;
  const asNumber = Number(result);
  return Number.isSafeInteger(asNumber) ? asNumber : null;
}
