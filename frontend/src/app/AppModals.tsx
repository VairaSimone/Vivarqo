import React from "react";
import type { FormEvent } from "react";
import { Dialog } from "../ui/Dialog";
import { Field, SelectField } from "../ui/FormControls";
import { t } from "../i18n";

export type ModalField = [
  name: string,
  label: string,
  type: "text" | "number" | "date" | "datetime-local" | "select" | "textarea",
  initial?: string | number
];
export type ModalForm = {
  title: string;
  endpoint: string;
  method?: "POST" | "PATCH";
  fields: ModalField[];
  transform?: (values: Record<string, string>) => Record<string, unknown>;
};

export function Modal({modal,onClose,onSubmit}: { modal: ModalForm; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
 return <Dialog title={modal.title} onClose={onClose} onSubmit={onSubmit} submitLabel={t("Salva")} size={modal.fields.length>6?"wide":"normal"}>
  {modal.fields.map(([name,label,type,initial])=><div className={type==="textarea"?"form-full":""} key={name}>{type==="select"?<SelectField label={label} name={name} defaultValue={initial ?? ""} required>{(name==="sex"?[["unknown","Non specificato"],["male","Maschio"],["female","Femmina"]]:name==="category"?[["food","Alimenti"],["substrate","Substrati"],["material","Materiali"],["equipment","Attrezzatura"],["other","Altro"]]:name==="taskCategory"?[["feeding","Alimentazioni"],["weighing","Peso"],["shed_check","Muta"],["cleaning","Pulizia"],["reproduction","Riproduzione"],["document","Documenti"],["inventory","Inventario"],["custom","Personalizzata"]]:name==="movementType"?[["in","Carico"],["out","Scarico"],["adjustment","Rettifica"]]:name==="entryType"?[["income","Entrata"],["expense","Uscita"]]:[]).map(([v,l])=><option key={v} value={v}>{t(l)}</option>)}</SelectField>:type==="textarea"?<label className="field"><span>{label}</span><textarea name={name} rows={3} defaultValue={initial}/></label>:<Field label={label} name={name} type={type} defaultValue={initial} step={type==="number"?0.001:undefined} required={!label.includes("facoltativo")&&name!=="minimumQuantity"&&name!=="unitCostCents"}/>}</div>)}
 </Dialog>;
}
