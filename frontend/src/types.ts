export type NoticeKind = "success" | "error" | "warning" | "info";
export type NoticeHandler = (message: string, kind?: NoticeKind) => void;
export type NavigationHandler = (section: string, options?: { animalId?: string | null }) => void;
export type UnknownRecord = Record<string, unknown>;

// Dynamic payloads are kept at the API boundary until each endpoint has a generated contract.
// Prefer domain interfaces for new feature code; do not use this for internal business logic.
export type AnyRecord = Record<string, any>;

export interface CommonHubProps {
  onNotice?: NoticeHandler;
  owner?: AccountUser | string | null;
  onGo?: NavigationHandler;
  initialAnimalId?: string | null;
  initialTab?: string;
  refreshKey?: number;
  [key: string]: unknown;
}

export interface AccountUser extends UnknownRecord {
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


/** Safely extracts a message from unknown values caught by async handlers. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Si è verificato un errore imprevisto.";
}
