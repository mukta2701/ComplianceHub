# ComplianceHub — primary users, ranked

Who actually uses an ISO 27001 / GRC readiness platform, ranked by how central
they are to the day-to-day of the product. The app's RBAC has two roles
(**owner**, **member**); persona 6 needs no login at all.

| Rank | Persona | Cadence | Role | What they do in ComplianceHub |
|------|---------|---------|------|-------------------------------|
| **1** | **ISMS / Compliance Manager** | Daily — the core user | Owner | Owns the whole readiness programme: runs the gap assessment, generates & finalises the **Statement of Applicability**, curates the evidence vault, drives remediation **Tasks**, watches **Monitoring**, and produces the **Leadership report**. The product is built around this role. |
| **2** | **Risk Owner / Risk Manager** | Weekly | Owner/Member | Owns the **Risk register**: records risks, scores inherent & residual likelihood × impact on the 5×5 matrix, sets treatments, and reads the risk **heat map**. |
| **3** | **Control / IT / System Owner** | As tasks land | Member | Assigned remediation **Tasks** and evidence collection for specific controls; attaches **Evidence**, closes tasks. Lives in Tasks + Evidence. |
| **4** | **Executive / Leadership (CISO, mgmt.)** | Monthly / for management review | Member (read-mostly) | Consumes the **dashboard** readiness gauge, **Monitoring** signals, and the **Leadership report**. Cares about posture and trend, not data entry. |
| **5** | **Internal Auditor** | Per audit cycle | Owner/Member | Plans and runs **Internal audits**, works the checklist, raises corrective-action tasks, downloads evidence packs. |
| **6** | **External Auditor / Customer / Prospect** | Occasional | *No login* | Views the public **Trust Center** or a minted read-only **auditor link**. Sees only safe summary data — never risks, findings, or evidence contents. |

## Why this ranking

- Personas **1–3** create and maintain the data; **1** is the anchor the whole
  workflow (assess → SoA → evidence → tasks → monitor) is designed for.
- Persona **4** is the reason the readiness gauge, Leadership report, and
  Monitoring view exist — decisions and reporting, not entry.
- Personas **5–6** are periodic/assurance-facing; the app serves them through
  the Internal audits module and the read-only Trust Center / auditor link.

## Verification

An end-to-end run was performed as **Persona 1** (a Compliance Manager,
"Priya Rao"): fresh sign-in → register organisation → run gap assessment →
generate a 93-control SoA → dashboard surfaces the blocking applicability
decisions → **Monitoring automatically flags 186 control gaps**. The full
registration-to-monitoring loop works.
