-- Original readiness prompts. They paraphrase common ISMS practices and do not reproduce ISO text.
insert into public.catalogue_versions (id, version, title, published_at) values
  ('00000000-0000-4000-8000-000000000001', '2026.1', 'ComplianceHub ISO 27001 readiness catalogue', now());

insert into public.catalogue_categories (id, catalogue_version_id, code, title, position) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'GOV', 'Governance and leadership', 0),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'RISK', 'Risk management', 1),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'OPS', 'Operational security', 2),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001', 'ASSURE', 'Assurance and improvement', 3);

insert into public.catalogue_questions (catalogue_version_id, category_id, code, prompt, guidance, remediation, weight, position) values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','GOV-01','Have senior leaders approved clear information security objectives?','Look for recorded approval, named owners and measurable outcomes.','Document objectives, obtain approval and schedule regular review.',2,0),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','GOV-02','Are information security responsibilities assigned and understood?','Consider permanent staff, contractors and key suppliers.','Create a responsibility map and communicate it to each role.',1,1),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000102','RISK-01','Do you use a repeatable method to identify and assess information security risks?','The method should define likelihood, impact and acceptance criteria.','Approve a risk method and apply it to the current scope.',2,0),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000102','RISK-02','Does every material security risk have an owner and treatment decision?','Review the risk register for gaps, stale reviews and missing owners.','Assign owners and record treatment decisions with target dates.',2,1),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000103','OPS-01','Are user access rights approved, reviewed and removed promptly?','Sample joiners, movers, leavers and privileged accounts.','Define an access lifecycle and run a documented access review.',2,0),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000103','OPS-02','Are important systems backed up and restoration tests recorded?','Evidence should show successful restore tests, not only backup jobs.','Set backup objectives and complete a representative restore test.',2,1),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000103','OPS-03','Can staff recognise and report a suspected security incident?','Check awareness material, reporting routes and recent exercises.','Publish a simple reporting route and run an incident exercise.',1,2),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000104','ASSURE-01','Do you evaluate whether security controls operate as intended?','Use evidence such as review results, tests and performance measures.','Define a control assurance schedule and retain results.',2,0),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000104','ASSURE-02','Are internal security audits planned and independently performed?','Independence means auditors do not assess their own work.','Create a risk-based audit programme and assign independent reviewers.',2,1),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000104','ASSURE-03','Are corrective actions tracked through to verified completion?','Look for root cause, owner, due date and effectiveness checks.','Use a corrective action log and verify effectiveness before closure.',1,2);
