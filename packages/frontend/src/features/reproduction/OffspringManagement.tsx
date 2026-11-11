import type { FormEvent } from "react";
import type { Locale } from "../../lib/domain";
import type { ClutchDto, OffspringBatchDto } from "@vivarqo/contracts/reproduction";
import { formatDate } from "../../lib/domain";
import { translate } from "../../lib/i18n";
import { Alert, Badge, Button, EmptyState, Field, Icon, IconButton, Input, Modal, Panel, PanelHeader, Select, Textarea } from "../../components/ui";

interface OffspringForm {
  clutchId: string;
  bornOn: string;
  count: string;
  notes: string;
}
interface Props {
  locale: Locale;
  batches: OffspringBatchDto[];
  clutches: ClutchDto[];
  editorOpen: boolean;
  isEditing: boolean;
  form: OffspringForm;
  error: string;
  busy: boolean;
  onAdd: () => void;
  onConvert: (batch: OffspringBatchDto) => void;
  onEdit: (batch?: OffspringBatchDto) => void;
  onDelete: (batch: OffspringBatchDto) => void;
  onChange: (form: OffspringForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function OffspringManagement({ locale, batches, clutches, editorOpen, isEditing, form, error, busy, onAdd, onConvert, onEdit, onDelete, onChange, onClose, onSubmit }: Props) {
  const t = (key: string) => translate(locale, key);
  return <>
    <Panel>
      <PanelHeader title={t("offspring")} action={<Button size="sm" onClick={onAdd}><Icon name="plus" />{t("addOffspring")}</Button>} />
      {batches.length ? <div className="record-list">{batches.map((batch) => <div className="record-row" key={batch.id}>
        <div><strong>{batch.count} {t("offspring")}</strong><small>{formatDate(batch.bornOn, locale)}</small><p>{batch.notes}</p></div>
        <div className="row-actions"><IconButton label={t("convertToAnimals")} onClick={() => onConvert(batch)}><Icon name="plus" /></IconButton><IconButton label={t("edit")} onClick={() => onEdit(batch)}><Icon name="edit" /></IconButton><IconButton label={t("delete")} onClick={() => onDelete(batch)}><Icon name="trash" /></IconButton></div>
      </div>)}</div> : <EmptyState title={t("noRecords")} />}
    </Panel>
    {editorOpen && <Modal title={isEditing ? t("edit") : t("addOffspring")} onClose={onClose}>
      <form className="form-stack" onSubmit={onSubmit}>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("bornOn")}><Input required type="date" value={form.bornOn} onChange={(e) => onChange({ ...form, bornOn: e.target.value })} /></Field>
        <Field label={t("clutches")}><Select value={form.clutchId} onChange={(e) => onChange({ ...form, clutchId: e.target.value })}><option value="">—</option>{clutches.map((clutch) => <option key={clutch.id} value={clutch.id}>{formatDate(clutch.laidOn, locale)}</option>)}</Select></Field>
        <Field label={t("count")}><Input required type="number" min="0" max="10000" value={form.count} onChange={(e) => onChange({ ...form, count: e.target.value })} /></Field>
        <Field label={t("notes")}><Textarea rows={3} value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} /></Field>
        <div className="modal-actions"><Button variant="secondary" type="button" onClick={onClose}>{t("cancel")}</Button><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </Modal>}
  </>;
}
