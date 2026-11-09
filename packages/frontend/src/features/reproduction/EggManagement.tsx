import type { Locale } from "../../lib/domain";
import type { EggDto } from "@vivarqo/contracts/reproduction";
import { translate } from "../../lib/i18n";
import { Badge, Button, EmptyState, Icon, IconButton, Panel, PanelHeader } from "../../components/ui";

interface Props {
  locale: Locale;
  eggs: EggDto[];
  onAdd: () => void;
  onEdit: (egg: EggDto) => void;
  onDelete: (egg: EggDto) => void;
}

export function EggManagement({ locale, eggs, onAdd, onEdit, onDelete }: Props) {
  const t = (key: string) => translate(locale, key);
  return <Panel>
    <PanelHeader title={t("eggs")} action={<Button size="sm" onClick={onAdd}><Icon name="plus" />{t("addEggs")}</Button>} />
    {eggs.length ? <div className="egg-grid">{eggs.map((egg) => <div className="egg-card" key={egg.id}>
      <span><Icon name="egg" size={18} /></span><strong>{egg.code || "—"}</strong><Badge>{egg.status}</Badge>
      <div className="row-actions"><IconButton label={t("edit")} onClick={() => onEdit(egg)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => onDelete(egg)}><Icon name="trash" /></IconButton></div>
    </div>)}</div> : <EmptyState title={t("noRecords")} />}
  </Panel>;
}
