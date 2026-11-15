export function suggestedInventoryQuantity(unit: string, preyWeightG: number | null): string {
  const normalized = unit.trim().toLocaleLowerCase("en");
  if (preyWeightG !== null && Number.isFinite(preyWeightG) && preyWeightG > 0) {
    if (["kg", "kilogram", "kilograms", "chilogrammo", "chilogrammi"].includes(normalized)) {
      return (Math.round(preyWeightG) / 1000).toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    }
    if (["g", "gr", "gram", "grams", "grammo", "grammi"].includes(normalized)) {
      return String(Math.round(preyWeightG * 1000) / 1000);
    }
  }
  return "1";
}
