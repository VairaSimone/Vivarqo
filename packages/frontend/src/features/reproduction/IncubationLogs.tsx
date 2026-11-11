import type { Locale } from "../../lib/domain";
import type { IncubationLogDto } from "@vivarqo/contracts/reproduction";
import { formatDateTime, formatTemperature } from "../../lib/domain";
import { translate } from "../../lib/i18n";
import { Button, EmptyState, Icon, IconButton, Panel, PanelHeader } from "../../components/ui";

interface Props {
  locale: Locale;
  logs: IncubationLogDto[];
  onAdd: () => void;
  onEdit: (log: IncubationLogDto) => void;
  onDelete: (log: IncubationLogDto) => void;
}

export function IncubationLogs({ locale, logs, onAdd, onEdit, onDelete }: Props) {
  const t = (key: string) => translate(locale, key);
  return <Panel>
    <PanelHeader title={t("incubation")} action={<Button size="sm" onClick={onAdd}><Icon name="plus" />{t("addIncubationLog")}</Button>} />
    {logs.length ? <div className="record-list">{logs.map((log) => <div className="record-row" key={log.id}>
      <div><strong>{log.eventType}</strong><small>{formatDateTime(log.recordedAt, locale)}</small>
        <p>{log.temperatureC !== null ? formatTemperature(log.temperatureC, locale) : "—"} · {log.humidityPct !== null ? `${log.humidityPct} %` : "—"}</p><small>{log.notes ?? ""}</small>
      </div>
      <div className="row-actions"><IconButton label={t("edit")} onClick={() => onEdit(log)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => onDelete(log)}><Icon name="trash" /></IconButton></div>
    </div>)}</div> : <EmptyState title={t("noRecords")} />}
  </Panel>;
}
