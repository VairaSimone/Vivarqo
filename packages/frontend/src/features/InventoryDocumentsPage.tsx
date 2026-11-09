import type { Locale } from "../lib/domain";
import { InventoryPage } from "./inventory/InventoryPage";
import { DocumentsPage } from "./inventory/DocumentsPage";

export function InventoryDocumentsPage({ locale, path, navigate }: { locale: Locale; path: string; navigate: (path: string) => void }) {
  return path.startsWith("/documents")
    ? <DocumentsPage locale={locale} path={path} navigate={navigate} />
    : <InventoryPage locale={locale} />;
}
