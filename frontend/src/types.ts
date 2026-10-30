export type NoticeKind = "success" | "error" | "warning" | "info";
export type NoticeHandler = (message: string, kind?: NoticeKind) => void;
export type NavigationHandler = (section: string, options?: { animalId?: string | null }) => void;
export type AnyRecord = Record<string, any>;

export interface CommonHubProps {
  onNotice?: NoticeHandler;
  owner?: AnyRecord | string | null;
  onGo?: NavigationHandler;
  initialAnimalId?: string | null;
  initialTab?: string;
  refreshKey?: number;
  [key: string]: any;
}

export interface AccountUser extends AnyRecord {
  id?: string;
  email?: string;
  displayName?: string;
  locale?: string;
  timezone?: string;
}

export interface InventoryFiltersState {
  active: string;
  category: string;
  lowStock: boolean;
}

export function readFormValues(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value === "string") values[key] = value.trim();
  }
  return values;
}
