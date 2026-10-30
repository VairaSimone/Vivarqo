import React from "react";
import type { AnyRecord, NavigationHandler } from "../types";
import { Icon } from "../ui/Icon";

export function MoreHub({onGo,groups,nav}: { onGo: NavigationHandler; groups: AnyRecord[]; nav: any[] }) {
 return <div className="more-hub">{groups.map(group=><section className="more-category" key={group.id}><div className="more-category-heading"><p className="eyebrow">{group.label}</p><span>{group.items.length} {group.items.length===1?"sezione":"sezioni"}</span></div><div className="more-grid">{group.items.map(id=>{const [,label,icon,description]=nav.find(item=>item[0]===id)||[];return <button className="more-card" key={id} onClick={()=>onGo(id)}><span className="more-icon" aria-hidden="true"><Icon name={icon} size={21}/></span><span className="more-copy"><strong>{label}</strong><small>{description}</small></span><span className="more-arrow" aria-hidden="true">↗</span></button>;})}</div></section>)}</div>;
}



