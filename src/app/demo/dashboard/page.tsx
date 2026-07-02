import Link from "next/link";
import { Card, PageIntro, Pill, Progress, Ring, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";

const cats = [["Organisational",70,"blue"],["People",48,"violet"],["Physical",78,"green"],["Technological",55,"amber"]] as const;
const gaps = [
  ["High priority","red","Formalise and test your incident response plan","Organisational"],
  ["High priority","red","Apply security updates within agreed timeframes","Technological"],
  ["Needs work","amber","Review supplier security before onboarding","Organisational"],
  ["Needs work","amber","Run role-based security training","People"],
] as const;
export default function Dashboard() {
  return <><PageIntro eyebrow="THURSDAY, 2 JULY" title="Good evening, Priya" body="Here’s where Northstar Labs stands on ISO 27001 readiness." action={<Link className="button primary" href="/demo/assessment">Continue assessment <Icon name="arrow"/></Link>}/>
    <div className="stats-grid"><Stat label="ASSESSMENT" value="75%" detail="15 of 20 answered"/><Stat label="PRIORITY GAPS" value="5" detail="2 need urgent attention" tone="amber"/><Stat label="OPEN RISKS" value="4" detail="3 high or critical" tone="red"/><Stat label="SOA REVIEW" value="6" detail="controls need review" tone="green"/></div>
    <div className="dashboard-grid"><Card className="readiness-card"><div className="card-head"><div><h3>Overall readiness</h3><p>Based on your latest answers</p></div><Pill>Draft assessment</Pill></div><div className="readiness-body"><Ring value={62}/><div className="category-bars">{cats.map(([name,value,tone])=><div key={name}><label><span>{name}</span><b>{value}%</b></label><Progress value={value} tone={tone}/></div>)}</div></div><div className="card-foot"><span><Icon name="clipboard"/>Assessment 75% complete</span><Link href="/demo/assessment">Review answers <Icon name="arrow"/></Link></div></Card>
      <Card className="risk-summary"><div className="card-head"><div><h3>Risk overview</h3><p>Inherent risk distribution</p></div><Link href="/demo/risks">View register</Link></div><div className="mini-heat">{Array.from({length:25},(_,i)=>{const row=4-Math.floor(i/5)+1,col=i%5+1,score=row*col; return <span key={i} className={score>=15?"critical":score>=10?"high":score>=5?"medium":"low"}>{[7,13,18,21].includes(i)?1:""}</span>})}</div><div className="heat-legend"><span><i className="low"/>Low</span><span><i className="medium"/>Medium</span><span><i className="high"/>High</span><span><i className="critical"/>Critical</span></div><div className="risk-mini-stats"><span><b>4</b>Open</span><span><b className="red-text">3</b>High / critical</span><span><b className="amber-text">2</b>Overdue</span></div></Card>
    </div>
    <div className="lower-grid"><Card><div className="card-head"><div><h3>Priority gaps</h3><p>Start with these to improve your readiness</p></div><Link href="/demo/assessment">View all gaps</Link></div><div className="gap-list">{gaps.map(([label,tone,text,cat],i)=><Link href="/demo/assessment" key={text}><b>{i+1}</b><span><strong>{text}</strong><small>{cat}</small></span><Pill tone={tone}>{label}</Pill><Icon name="arrow"/></Link>)}</div></Card><Card><div className="card-head"><div><h3>Recent activity</h3><p>Latest changes in your workspace</p></div></div><ul className="activity"><li><i className="amber"/><span><b>Patch management marked “No”</b><small>Just now · Priya Shah</small></span></li><li><i className="green"/><span><b>MFA control marked implemented</b><small>2 hours ago · Tom Reilly</small></span></li><li><i className="blue"/><span><b>New ransomware risk added</b><small>Yesterday · Dan Okoro</small></span></li><li><i className="red"/><span><b>Backup review became overdue</b><small>2 days ago · System</small></span></li></ul></Card></div>
  </>;
}
