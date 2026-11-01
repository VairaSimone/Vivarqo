import React from "react";
import { t } from "../i18n";
import type { InventoryFiltersState } from "../types";
function Button({children,variant="secondary",...props}: React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?:string}){return <button className={"button "+variant} {...props}>{children}</button>;}
function SelectField({label,children,...props}: React.SelectHTMLAttributes<HTMLSelectElement> & {label:string;children?:React.ReactNode}){return <label className="field"><span>{label}</span><select {...props}>{children}</select></label>;}

export function InventoryFilters({filters,onChange,onReset}: { filters: InventoryFiltersState; onChange: (key: keyof InventoryFiltersState, value: string | boolean) => void; onReset: () => void }) {
 return <section className="panel inventory-filter-panel" aria-labelledby="inventory-filters-title">
  <div className="panel-heading"><div><p className="eyebrow">{t("CONTROLLO SCORTE")}</p><h2 id="inventory-filters-title">{t("Filtra inventario")}</h2><p className="subheading">{t("Individua articoli attivi, archiviati o con quantità sotto la soglia minima.")}</p></div><Button variant="secondary" onClick={onReset}>{t("Azzera filtri")}</Button></div>
  <div className="form-grid">
   <SelectField label={t("Stato articoli")} value={filters.active} onChange={event=>onChange("active",event.target.value)}>
    <option value="true">{t("Solo attivi")}</option><option value="false">{t("Solo archiviati")}</option><option value="all">{t("Tutti gli articoli")}</option>
   </SelectField>
   <SelectField label={t("Categoria")} value={filters.category} onChange={event=>onChange("category",event.target.value)}>
    <option value="">{t("Tutte le categorie")}</option><option value="food">{t("Alimenti")}</option><option value="substrate">{t("Substrati")}</option><option value="material">{t("Materiali")}</option><option value="equipment">{t("Attrezzatura")}</option><option value="other">{t("Altro")}</option>
   </SelectField>
   <label className="check-row form-full"><input type="checkbox" checked={filters.lowStock} onChange={event=>onChange("lowStock",event.target.checked)}/><span>{t("Mostra solo articoli sotto la soglia minima")}</span></label>
  </div>
 </section>;
}

