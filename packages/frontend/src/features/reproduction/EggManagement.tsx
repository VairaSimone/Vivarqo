import type { Locale } from "../../lib/domain";
import type { EggDto } from "@vivarqo/contracts/reproduction";
import { formatDate } from "../../lib/domain";
import { translate } from "../../lib/i18n";
import { Badge, Button, EmptyState, Icon, IconButton, Panel, PanelHeader } from "../../components/ui";

interface Props {
  locale: Locale;
  eggs: EggDto[];
  onAdd: () => void;
  onEdit: (egg: EggDto) => void;
  onDelete: (egg: EggDto) => void;
  onMeasure: (egg: EggDto) => void;
}
const labels: Record<string, { it: string; en: string }> = {
  unknown: { it: "Da valutare", en: "Unassessed" },
  fertile: { it: "Fertile", en: "Fertile" },
  infertile: { it: "Non fertile", en: "Infertile" },
  damaged: { it: "Danneggiato", en: "Damaged" },
  collapsed: { it: "Collassato", en: "Collapsed" },
  lost: { it: "Perso", en: "Lost" },
  incubating: { it: "In incubazione", en: "Incubating" },
  hatched: { it: "Schiuso", en: "Hatched" },
};
export function EggManagement({ locale, eggs, onAdd, onEdit, onDelete, onMeasure }: Props) {
  const t = (key: string) => translate(locale, key);
  return <Panel>
    <PanelHeader title={t("eggs")} action={<Button size="sm" onClick={onAdd}><Icon name="plus" />{t("addEggs")}</Button>} />
    {eggs.length ? <div className="egg-grid">{eggs.map((egg) => <div className="egg-card" key={egg.id}>
      <span><Icon name="egg" size={18} /></span><strong>{egg.code || "—"}</strong>
      <Badge tone={egg.status === "hatched" ? "success" : egg.status === "lost" || egg.status === "damaged" || egg.status === "collapsed" ? "danger" : "neutral"}>{labels[egg.status]?.[locale] ?? egg.status}</Badge>
      {egg.measurements?.length ? <small>{locale === "it" ? "Ultimo peso: " : "Latest weight: "}{egg.measurements[egg.measurements.length - 1]?.weightG} g</small> : null}
      {egg.expectedHatchAt && <small>{locale === "it" ? "Schiusa prevista: " : "Expected hatch: "}{formatDate(egg.expectedHatchAt, locale)}</small>}
      {egg.hatchedAt && <small>{locale === "it" ? "Schiusa: " : "Hatched: "}{formatDate(egg.hatchedAt, locale)}</small>}
      {egg.offspringAnimal && <small>{locale === "it" ? "Piccolo: " : "Hatchling: "}{egg.offspringAnimal.name}</small>}
      {egg.history?.length ? <div className="egg-history"><small>{locale === "it" ? "Cronologia" : "History"}</small>{egg.history.slice(-3).map((entry) => <small key={entry.id}>{labels[entry.status]?.[locale] ?? entry.status} · {formatDate(entry.occurredAt, locale)}</small>)}</div> : null}
      <div className="row-actions"><IconButton label={locale === "it" ? "Registra peso" : "Record weight"} onClick={() => onMeasure(egg)}><Icon name="scale" /></IconButton><IconButton label={t("edit")} onClick={() => onEdit(egg)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => onDelete(egg)}><Icon name="trash" /></IconButton></div>
    </div>)}</div> : <EmptyState title={t("noRecords")} />}
  </Panel>;
}
