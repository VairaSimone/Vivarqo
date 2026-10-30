export type NoticeKind = "success" | "error" | "warning" | "info";
export type NoticeHandler = (message: string, kind?: NoticeKind) => void;
export type NavigationHandler = (section: string) => void;
export type AnyRecord = Record<string, any>;

export interface CommonHubProps {
  onNotice?: NoticeHandler;
  owner?: AnyRecord | null;
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
