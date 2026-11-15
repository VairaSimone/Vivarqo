export type AnimalLocationNode = { id: string; name: string; parentId: string | null };
export function getLocationDescendantIds(locations: AnimalLocationNode[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const location of locations) {
    if (!location.parentId) continue;
    const list = children.get(location.parentId) ?? [];
    list.push(location.id);
    children.set(location.parentId, list);
  }
  const result: string[] = [];
  const pending = [rootId];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    pending.push(...(children.get(current) ?? []));
  }
  return result;
}
export function getLocationPath(locations: AnimalLocationNode[], locationId: string | null | undefined, unassigned = "Unassigned"): string {
  if (!locationId) return unassigned;
  const byId = new Map(locations.map((location) => [location.id, location]));
  const names: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(locationId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.length ? names.join(" / ") : "—";
}
