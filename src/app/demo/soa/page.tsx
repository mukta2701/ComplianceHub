"use client";
import { useMemo, useState } from "react";
import { Card, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
const rows = [
 ["A.5.1","Information security policies","Organisational","Implemented","Annual policy review is owned by the security lead."],
 ["A.5.2","Information security roles","Organisational","Implemented","Responsibilities are recorded in role descriptions."],
 ["A.5.7","Threat intelligence","Organisational","Planned","A proportionate monitoring process will be introduced."],
 ["A.5.19","Supplier relationships","Organisational","Partial","New suppliers are checked; annual reviews are being added."],
 ["A.6.3","Security awareness and training","People","Partial","Induction exists; role-specific refreshers are planned."],
 ["A.7.2","Physical entry","Physical","Implemented","Managed access controls protect the office."],
 ["A.8.5","Secure authentication","Technological","Implemented","MFA is enforced for cloud and administrative systems."],
 ["A.8.8","Technical vulnerability management","Technological","Planned","Patch targets need formal approval and reporting."],
 ["A.8.13","Information backup","Technological","Partial","Backups run daily; restore testing is overdue."],
 ["A.8.23","Web filtering","Technological","N/A","No managed network or corporate endpoint fleet."],
] as const;
export default function Soa(){
 const [query,setQuery]=useState(""),[status,setStatus]=useState("All statuses");
 const filtered=useMemo(()=>rows.filter(r=>(status==="All statuses"||r[3]===status)&&r.join(" ").toLowerCase().includes(query.toLowerCase())),[query,status]);
 return <><PageIntro title="Statement of Applicability" body="Review which controls apply, record your reasoning, and export an audit-ready draft." action={<div className="button-group"><a className="button secondary" href="/api/demo/soa/docx"><Icon name="download"/> Word</a><a className="button primary" href="/api/demo/soa/pdf"><Icon name="download"/> Export PDF</a></div>}/><div className="stats-grid soa-stats"><Stat label="TOTAL CONTROLS" value="93" detail="ISO 27001:2022 Annex A"/><Stat label="APPLICABLE" value="84" detail="90% of controls" tone="green"/><Stat label="NOT APPLICABLE" value="9" detail="with justification"/><Stat label="NEEDS REVIEW" value="6" detail="partial or planned" tone="amber"/></div><Card className="soa-card"><div className="table-tools"><label><span className="sr-only">Search controls</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by reference or control…"/></label><select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Filter status"><option>All statuses</option><option>Implemented</option><option>Partial</option><option>Planned</option><option>N/A</option></select><span>{filtered.length} controls shown</span></div><div className="data-table-wrap"><table><thead><tr><th>Control</th><th>Applicability</th><th>Status</th><th>Justification & evidence</th><th><span className="sr-only">Edit</span></th></tr></thead><tbody>{filtered.map(r=><tr key={r[0]}><td><code>{r[0]}</code><b>{r[1]}</b><small>{r[2]}</small></td><td><Pill tone={r[3]==="N/A"?"neutral":"blue"}>{r[3]==="N/A"?"Not applicable":"Applicable"}</Pill></td><td><Pill tone={r[3]==="Implemented"?"green":r[3]==="Partial"?"amber":r[3]==="Planned"?"blue":"neutral"}><i/>{r[3]}</Pill></td><td>{r[4]}</td><td><button aria-label={`Edit ${r[1]}`}>•••</button></td></tr>)}</tbody></table></div></Card></>;
}
