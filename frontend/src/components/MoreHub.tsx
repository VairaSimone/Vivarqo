import React from "react";
import type { AnyRecord, NavigationHandler } from "../types";
import { Icon } from "../ui/Icon";

type NavGroup = { id: string; label: string; items: string[] };

export function MoreHub({onGo,groups,nav}: { onGo: NavigationHandler; groups: NavGroup[]; nav: string[][] }) {
 return <div className="more-hub">{groups.map(group=><section className="more-category" key={group.id}><div className="more-category-heading"><p className="eyebrow">{group.label}</p><span>{group.items.length} {group.items.length===1?"sezione":"sezioni"}</span></div><div className="more-grid">{group.items.map((id:string)=>{const item=nav.find(entry=>entry[0]===id)||[]; const label=item[1]||id; const icon=item[2]||"home"; const description=item[3]||"";return <button className="more-card" key={id} onClick={()=>onGo(id)}><span className="more-icon" aria-hidden="true"><Icon name={icon} size={21}/></span><span className="more-copy"><strong>{label}</strong><small>{description}</small></span><span className="more-arrow" aria-hidden="true">↗</span></button>;})}</div></section>)}</div>;
}



