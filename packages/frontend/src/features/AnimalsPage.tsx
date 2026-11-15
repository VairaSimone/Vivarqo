import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Alert, LoadingState } from "../components/ui";
import type { Locale } from "../lib/domain";
import { AnimalListPage } from "./animals/AnimalListPage";
import { AnimalDetailPage } from "./animals/AnimalDetailPage";

export function AnimalsPage({ locale, navigate, path }: { locale: Locale; navigate: (path: string) => void; path: string }) {
  const qrToken = path.match(/^\\/animals\\/qr\\/([A-Za-z0-9_-]{32})/)?.[1];
  const [qrError, setQrError] = useState("");
  useEffect(() => {
    if (!qrToken) return;
    let active = true;
    api.get<{ animal: { id: string } }>(`/animals/qr/${encodeURIComponent(qrToken)}`).then((result) => {
      if (active) navigate(`/animals/${encodeURIComponent(result.animal.id)}`);
    }).catch((reason: unknown) => {
      if (active) setQrError(reason instanceof ApiError ? reason.message : (locale === "it" ? "QR non valido o animale non disponibile." : "Invalid QR or animal unavailable."));
    });
    return () => { active = false; };
  }, [qrToken, navigate, locale]);
  if (qrToken) return qrError ? <Alert tone="danger">{qrError}</Alert> : <LoadingState />;
  const animalId = path.match(/^\/animals\/([^/?]+)/)?.[1];
  return animalId
    ? <AnimalDetailPage id={animalId} locale={locale} navigate={navigate} />
    : <AnimalListPage locale={locale} navigate={navigate} path={path} />;
}
