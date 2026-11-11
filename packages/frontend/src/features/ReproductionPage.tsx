import type { Locale } from "../lib/domain";
import { CycleList } from "./reproduction/CycleList";
import { CycleDetail } from "./reproduction/CycleDetail";
import { ClutchDetail } from "./reproduction/ClutchDetail";

export function ReproductionPage({ locale, path, navigate }: { locale: Locale; path: string; navigate: (path: string) => void }) {
  const cycleId = path.match(/^\/reproduction-cycles\/([^/?]+)/)?.[1];
  const clutchId = path.match(/^\/clutches\/([^/?]+)/)?.[1];
  if (cycleId) return <CycleDetail id={cycleId} locale={locale} navigate={navigate} />;
  if (clutchId) return <ClutchDetail id={clutchId} locale={locale} navigate={navigate} />;
  return <CycleList locale={locale} path={path} navigate={navigate} />;
}
