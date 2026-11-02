import { useResource } from "../hooks/useResource";
import { getString } from "../lib/domain";
import type { Locale } from "../lib/domain";
import { translate } from "../lib/i18n";
import { Badge, Icon, LoadingState, ErrorState } from "../components/ui";

export function PublicAnimalPage({ slug, locale }: { slug: string; locale: Locale }) {
  const resource = useResource<Record<string, unknown>>(`/public/animals/${encodeURIComponent(slug)}`);
  const animal = (resource.data?.animal ?? resource.data) as Record<string, unknown> | undefined;
  const visible = Object.keys(animal ?? {});
  const t = (key: string) => translate(locale, key);
  if (resource.loading) return <div className="public-loading"><LoadingState /></div>;
  if (resource.error || !animal) return <div className="public-loading"><div className="public-error"><Icon name="leaf" size={26} /><h1>Vivarqo</h1><p>{resource.error?.message ?? t("noRecords")}</p></div></div>;
  const fields: Record<string, string> = { name: t("name"), species: t("species"), morph: t("morph"), sex: t("sex"), birthDate: t("birthDate") };
  return <div className="public-page">
    <header className="public-header"><span className="brand-mark"><Icon name="leaf" /></span><strong>vivarqo</strong><span className="public-badge"><Icon name="shield" size={13} />{locale === "it" ? "Scheda condivisa" : "Shared profile"}</span></header>
    <main className="public-animal-card">
      <span className="eyebrow">{getString(animal, "species")}</span>
      <h1>{getString(animal, "name")}</h1>
      {getString(resource.data, "description") && <p className="public-description">{getString(resource.data, "description")}</p>}
      <div className="public-fields">{visible.filter((field) => field in fields).map((field) => <div key={field}><span>{fields[field]}</span><strong>{field === "sex" ? t(getString(animal, "sex")) : getString(animal, field) || "—"}</strong></div>)}</div>
      <footer><Icon name="lock" size={14} />{locale === "it" ? "Sono mostrati soltanto i dati autorizzati dall'allevatore." : "Only information approved by the breeder is displayed."}</footer>
    </main>
  </div>;
}