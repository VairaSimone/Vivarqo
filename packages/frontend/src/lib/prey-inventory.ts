export function suggestedInventoryQuantity(unit: string, preyWeightG: number | null): string {
  const normalized = unit.trim().toLocaleLowerCase("en");
  if (preyWeightG !== null && Number.isFinite(preyWeightG) && preyWeightG > 0) {
    if (["kg", "kilogram", "kilograms", "chilogrammo", "chilogrammi"].includes(normalized)) {
      return Number((preyWeightG / 1000).toFixed(3)).toString();
    }
    if (["g", "gr", "gram", "grams", "grammo", "grammi"].includes(normalized)) {
      return Number(preyWeightG.toFixed(3)).toString();
    }
  }
  return "1";
}
