import React from "react";
function Button({children,variant="secondary",...props}){return <button className={"button "+variant} {...props}>{children}</button>;}
function SelectField({label,children,...props}){return <label className="field"><span>{label}</span><select {...props}>{children}</select></label>;}

export function InventoryFilters({filters,onChange,onReset}) {
 return <section className="panel inventory-filter-panel" aria-labelledby="inventory-filters-title">
  <div className="panel-heading"><div><p className="eyebrow">CONTROLLO SCORTE</p><h2 id="inventory-filters-title">Filtra inventario</h2><p className="subheading">Individua articoli attivi, archiviati o con quantità sotto la soglia minima.</p></div><Button variant="secondary" onClick={onReset}>Azzera filtri</Button></div>
  <div className="form-grid">
   <SelectField label="Stato articoli" value={filters.active} onChange={event=>onChange("active",event.target.value)}>
    <option value="true">Solo attivi</option><option value="false">Solo archiviati</option><option value="all">Tutti gli articoli</option>
   </SelectField>
   <SelectField label="Categoria" value={filters.category} onChange={event=>onChange("category",event.target.value)}>
    <option value="">Tutte le categorie</option><option value="food">Alimenti</option><option value="substrate">Substrati</option><option value="material">Materiali</option><option value="equipment">Attrezzatura</option><option value="other">Altro</option>
   </SelectField>
   <label className="check-row form-full"><input type="checkbox" checked={filters.lowStock} onChange={event=>onChange("lowStock",event.target.checked)}/><span>Mostra solo articoli sotto la soglia minima</span></label>
  </div>
 </section>;
}

