"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, PageIntro, Progress } from "@/components/ui";
import { Icon } from "@/components/icons";

const questions = [
 ["Organisational","Do you have a written information security policy that is reviewed regularly?","A current policy gives your team a shared baseline and shows reviewers that security is actively governed."],
 ["Organisational","Are security responsibilities clearly assigned to named people?","Clear ownership prevents important tasks falling between teams."],
 ["Organisational","Do you have a documented process for responding to security incidents?","A rehearsed response reduces harm and helps you meet reporting obligations."],
 ["Organisational","Do you assess supplier security before giving them access to data?","Third parties can introduce risks you do not directly control."],
 ["People","Do new starters complete security training?","Training helps people recognise common threats and understand expectations."],
 ["People","Is access removed promptly when someone leaves?","Fast offboarding reduces the window for unauthorised access."],
 ["Physical","Are offices and equipment protected against unauthorised access?","Physical controls protect systems and information from loss or interference."],
 ["Technological","Is multi-factor authentication required for important systems?","MFA limits account takeover even when passwords are compromised."],
 ["Technological","Are security updates applied within agreed timeframes?","Timely patching closes known weaknesses before they can be exploited."],
 ["Technological","Are backups tested by restoring data at least annually?","A backup only provides assurance when you know it can be restored."],
] as const;
type Answer = "yes"|"partially"|"no"|"na";
const labels: [Answer,string,string][] = [["yes","Yes","This is in place and working"],["partially","Partially","Some parts are in place"],["no","No","This is not currently in place"],["na","Not applicable","This does not apply to us"]];
export default function Assessment() {
 const [index,setIndex]=useState(0); const [answers,setAnswers]=useState<Record<number,Answer>>({0:"partially",1:"yes",4:"yes",7:"yes",8:"no"}); const [notes,setNotes]=useState<Record<number,string>>({}); const [saving,setSaving]=useState(false);
 useEffect(()=>{if(!saving)return;const t=setTimeout(()=>setSaving(false),650);return()=>clearTimeout(t)},[saving,answers,notes]);
 const done=Object.keys(answers).length; const q=questions[index]; const categories=useMemo(()=>["Organisational","People","Physical","Technological"].map(name=>({name,total:questions.filter(x=>x[0]===name).length,done:questions.filter((x,i)=>x[0]===name&&answers[i]).length,first:questions.findIndex(x=>x[0]===name)})),[answers]);
 return <><PageIntro title="Gap assessment" body="Answer honestly based on what happens today. You can add evidence and return at any time." action={<span className={`save-state ${saving?"saving":""}`}><Icon name={saving?"settings":"check"}/>{saving?"Saving…":"All changes saved"}</span>}/><Card className="assessment-progress"><div><b>{done} of {questions.length} answered</b><span>{Math.round(done/questions.length*100)}% complete</span></div><Progress value={done/questions.length*100}/></Card>
 <div className="assessment-layout"><Card className="question-nav"><h3>Assessment areas</h3>{categories.map(c=><button key={c.name} className={q[0]===c.name?"active":""} onClick={()=>setIndex(c.first)}><i className={c.name.toLowerCase()}/><span>{c.name}<small>{c.done} of {c.total}</small></span><b>{c.done===c.total?<Icon name="check"/>:`${c.done}/${c.total}`}</b></button>)}<div className="nav-note"><Icon name="lock"/><p><b>Your progress is private</b>Only members of this workspace can view your answers.</p></div></Card>
 <Card className="question-card"><div className="question-meta"><span>{q[0]}</span><b>Question {index+1} of {questions.length}</b></div><h2>{q[1]}</h2><div className="why"><b>Why this matters</b><p>{q[2]}</p></div><fieldset><legend className="sr-only">Select an answer</legend>{labels.map(([value,label,desc])=><button type="button" key={value} className={`answer ${answers[index]===value?`selected ${value}`:""}`} onClick={()=>{setAnswers(a=>({...a,[index]:value}));setSaving(true)}}><i>{answers[index]===value&&<Icon name="check"/>}</i><span><b>{label}</b><small>{desc}</small></span></button>)}</fieldset><label className="evidence">Evidence or notes <span>Optional</span><textarea value={notes[index]??""} onChange={e=>{setNotes(n=>({...n,[index]:e.target.value}));setSaving(true)}} placeholder="For example: link to a policy, describe the current process, or note who owns this…"/><small>Do not add passwords, secrets, or sensitive personal data.</small></label><div className="question-actions"><button className="button secondary" disabled={index===0} onClick={()=>setIndex(i=>i-1)}>← Previous</button><button className="button primary" onClick={()=>setIndex(i=>Math.min(questions.length-1,i+1))}>{index===questions.length-1?"Review answers":"Next question"} <Icon name="arrow"/></button></div></Card></div></>;
}
