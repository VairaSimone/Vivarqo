import type { Locale } from "../lib/domain";
import { AnimalListPage } from "./animals/AnimalListPage";
import { AnimalDetailPage } from "./animals/AnimalDetailPage";

export function AnimalsPage({ locale, navigate, path }: { locale: Locale; navigate: (path: string) => void; path: string }) {
  const animalId = path.match(/^\/animals\/([^/?]+)/)?.[1];
  return animalId
    ? <AnimalDetailPage id={animalId} locale={locale} navigate={navigate} />
    : <AnimalListPage locale={locale} navigate={navigate} path={path} />;
}
