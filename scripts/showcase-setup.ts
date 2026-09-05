/** Local fictional showcase. Database access is read-only; writes use supported app UI/APIs. */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertLocalTargets(api: string, site: string) {
  for (const [value, port] of [[api, '54321'], [site, '3100']]) {
    const u = new URL(value);
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(u.hostname) || u.port !== port || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('Showcase requires exact loopback API :54321 and site :3100 origins');
  }
}
// Supabase rows are checked against explicit expected fields before reuse.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
 type Row = { id: string; [key: string]: any };
export function reconcileRecord(rows: Row[], savedId: string | undefined, expected: Record<string, unknown>): Row | null {
  if (rows.length > 1) throw new Error('Showcase duplicate stable key; refusing mutation');
  const row = rows[0];
  if (!row) { if (savedId) throw new Error('Manifest record missing; refusing recreation'); return null; }
  if (savedId && savedId !== row.id) throw new Error('Manifest ID collision');
  for (const [key, value] of Object.entries(expected)) if (row[key] !== value) throw new Error(`Showcase drift in ${key}`);
  return row;
}
export function fingerprintRows(rows: Row[]): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
  }
  return createHash('sha256').update(JSON.stringify(canonical([...rows].sort((a, b) => a.id.localeCompare(b.id))))).digest('hex');
}
type ShowcaseMemberManifest = { version: string; organisationId: string; ownerId: string; memberId: string };
type Membership = { user_id: string; organisation_id: string; role: string };
export function assertShowcaseMemberships(members: Membership[], ownerMemberships: Membership[], organisationId: string, ownerId: string, memberManifest?: ShowcaseMemberManifest) {
  if (ownerMemberships.length !== 1 || ownerMemberships[0].organisation_id !== organisationId || ownerMemberships[0].user_id !== ownerId || ownerMemberships[0].role !== 'owner') throw new Error('Owner workspace membership drift');
  if (memberManifest && (memberManifest.version !== 'showcase-member-v1' || memberManifest.organisationId !== organisationId || memberManifest.ownerId !== ownerId || !memberManifest.memberId || memberManifest.memberId === ownerId)) throw new Error('Member manifest collision');
  const expected = new Map([[ownerId, 'owner']]); if (memberManifest) expected.set(memberManifest.memberId, 'member');
  if (members.length !== expected.size || new Set(members.map((member) => member.user_id)).size !== expected.size || members.some((member) => member.organisation_id !== organisationId || expected.get(member.user_id) !== member.role)) throw new Error('Showcase membership drift');
}
export async function acquireLock(directory: string) {
  const lock = path.join(directory, 'setup.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); } catch { throw new Error('Showcase setup is locked. Check the recorded process before manually removing a stale lock.'); }
  await handle.writeFile(String(process.pid)); await handle.close();
  return async () => { await unlink(lock); };
}
const SPEC = {
  version: 'showcase-v1', organisation: 'Northstar Demo — Showcase v1', email: 'showcase-owner@example.test', owner: 'Northstar Showcase Owner',
  riskRef: 'NS-R-001', riskTitle: 'Quarterly access reviews need independent sign-off',
  planRef: 'NS-RTP-001', evidenceTitle: 'Northstar fictional access review sample — September 2026',
  policyRef: 'NS-POL-001', policyTitle: 'Northstar access review policy', auditRef: 'NS-AUD-001', auditTitle: 'Northstar access governance review',
  note: 'FICTIONAL SHOWCASE v1: Northstar has documented baseline controls. Independent sign-off of quarterly access reviews remains a tracked improvement (NS-R-001 / NS-RTP-001). This is demonstration data, not audit assurance.',
  due: '2026-12-31', checklist: 'Has the quarterly access review received independent sign-off?',
};
type Manifest = { version: string; organisation: string; ownerEmail: string; ids: Record<string, string>; urls: Record<string, string>; counts: Record<string, number>; fingerprints?: Record<string, string>; verifiedAt?: string };

export async function main() {
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const rawSite = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const site = rawSite ? new URL(rawSite).origin : '';
  assertLocalTargets(api, rawSite);
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anon || !service) throw new Error('Run through the local demo launcher; local keys must be explicitly supplied');
  const verifyOnly = process.argv.includes('--verify-only');
  if (process.argv.slice(2).some((arg) => arg !== '--verify-only')) throw new Error('Only --verify-only is supported');
  const dir = path.resolve('artifacts/showcase-v1'); await mkdir(dir, { recursive: true, mode: 0o700 });
  const release = await acquireLock(dir);
  const { createClient } = await import('@supabase/supabase-js');
  const { chromium, expect } = await import('@playwright/test');
  const admin = createClient(api, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = createClient(api, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch();
    const manifestPath = path.join(dir, 'manifest.json');
    let manifest: Manifest;
    try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; manifest = { version: SPEC.version, organisation: SPEC.organisation, ownerEmail: SPEC.email, ids: {}, urls: {}, counts: {} }; }
    if (manifest.version !== SPEC.version || manifest.organisation !== SPEC.organisation || manifest.ownerEmail !== SPEC.email) throw new Error('Showcase manifest identity collision');
    const persist = async () => { await writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 }); await rename(`${manifestPath}.tmp`, manifestPath); };
    const credentialsPath = path.join(dir, 'credentials.json');
    let credentials: { email: string; password: string };
    try { credentials = JSON.parse(await readFile(credentialsPath, 'utf8')); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || verifyOnly) throw e;
      credentials = { email: SPEC.email, password: `Ns-${randomBytes(24).toString('base64url')}-Aa1!` };
      await writeFile(credentialsPath, JSON.stringify(credentials) + '\n', { mode: 0o600, flag: 'wx' });
    }
    if (credentials.email !== SPEC.email) throw new Error('Credential identity collision');
    const statePath = path.join(dir, 'browser-session.json');
    let storageState: import('@playwright/test').BrowserContextOptions['storageState'];
    try { storageState = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const context = await browser.newContext({ baseURL: site, storageState }); const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    async function submitLocator(button: import('@playwright/test').Locator) {
      const pathname = new URL(page.url()).pathname;
      const response = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).origin === site && new URL(r.url()).pathname === pathname);
      await button.click();
      const r = await response;
      if (r.status() >= 400) throw new Error(`App action failed (${r.status()})`);
    }
    async function submit(button: string) { await submitLocator(page.getByRole('button', { name: button, exact: true })); }
    const users = [];
    for (let p = 1; ; p++) {
      const result = await admin.auth.admin.listUsers({ page: p, perPage: 1000 }); if (result.error) throw result.error;
      users.push(...result.data.users.filter((u) => u.email === SPEC.email)); if (result.data.users.length < 1000) break;
    }
    if (users.length > 1) throw new Error('Duplicate synthetic user');
    let user = users[0];
    if (!user) {
      if (verifyOnly || manifest.ids.user) throw new Error('Showcase user missing');
      await page.goto('/sign-up'); await page.getByLabel('Name', { exact: true }).fill(SPEC.owner);
      await page.getByLabel('Email', { exact: true }).fill(credentials.email);
      await page.getByLabel('Password', { exact: true }).fill(credentials.password); await page.getByLabel('Confirm password').fill(credentials.password);
      await submit('Create account');
      const result = await admin.auth.admin.listUsers({ perPage: 1000 }); if (result.error) throw result.error;
      user = result.data.users.find((u) => u.email === SPEC.email)!;
      if (!user) throw new Error('Signup did not create synthetic user');
      manifest.ids.user = user.id; await persist();
    } else if (!manifest.ids.user) throw new Error('Unclaimed showcase email collision; refusing to adopt an existing user');
    if (manifest.ids.user !== user.id) throw new Error('Synthetic user ID drift');
    if (!user.email_confirmed_at) {
      if (verifyOnly) throw new Error('Synthetic user is unconfirmed');
      // Local confirmation only; never affects any other account.
      const result = await admin.auth.admin.updateUserById(user.id, { email_confirm: true }); if (result.error) throw result.error;
    }
    const login = await db.auth.signInWithPassword(credentials); if (login.error) throw new Error('Synthetic credentials no longer match');
    await page.goto('/app');
    if (new URL(page.url()).pathname === '/sign-in') {
      await page.getByLabel('Email', { exact: true }).fill(credentials.email); await page.getByLabel('Password', { exact: true }).fill(credentials.password); await submit('Sign in');
      await page.waitForURL((url) => url.pathname.startsWith('/app'));
    }
    await writeFile(statePath, JSON.stringify(await context.storageState()), { mode: 0o600 });
    const orgResult = await admin.from('organisations').select('*').eq('name', SPEC.organisation); if (orgResult.error) throw orgResult.error;
    let org = reconcileRecord(orgResult.data, manifest.ids.organisation, { name: SPEC.organisation });
    if (!org) {
      if (verifyOnly) throw new Error('Showcase workspace missing');
      await expect(page.getByRole('heading', { name: 'Create your organisation' })).toBeVisible();
      await page.getByLabel('Organisation name').fill(SPEC.organisation); await submit('Create workspace');
      const result = await db.from('organisations').select('*').eq('name', SPEC.organisation); if (result.error) throw result.error;
      org = reconcileRecord(result.data, undefined, { name: SPEC.organisation }); if (!org) throw new Error('Workspace creation failed');
    } else if (!manifest.ids.organisation) throw new Error('Unclaimed organisation collision');
    manifest.ids.organisation = org.id; await persist();
    const membership = await db.from('memberships').select('user_id,organisation_id,role').eq('organisation_id', org.id);
    const ownerMemberships = await db.from('memberships').select('user_id,organisation_id,role').eq('user_id', user.id);
    if (membership.error || ownerMemberships.error) throw new Error('Could not verify showcase memberships');
    let memberManifest: ShowcaseMemberManifest | undefined;
    try { memberManifest = JSON.parse(await readFile(path.join(dir, 'member-manifest.json'), 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    assertShowcaseMemberships(membership.data, ownerMemberships.data, org.id, user.id, memberManifest);
    if (memberManifest) { const member = await admin.auth.admin.getUserById(memberManifest.memberId); if (member.error || member.data.user.email !== 'showcase-member@example.test') throw new Error('Synthetic member identity collision'); }
    await page.goto('/app');
    await expect(page.getByText(SPEC.organisation, { exact: true }).first()).toBeVisible();
    async function rows(table: string, filters: Record<string, string> = {}) {
      let query = db.from(table).select('*').eq('organisation_id', org!.id);
      for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
      const result = await query; if (result.error) throw result.error; return result.data as Row[];
    }
    async function waitExpected(table: string, filters: Record<string, string>, expected: Record<string, unknown>) {
      await expect.poll(async () => { const current = await rows(table, filters); return current.length === 1 && Object.entries(expected).every(([key, value]) => current[0][key] === value); }, { timeout: 30_000 }).toBe(true);
    }
    for (const [table, count] of Object.entries(manifest.counts)) {
      const current = await rows(table);
      if (current.length !== count) throw new Error(`Showcase count drift: ${table}`);
      if (manifest.fingerprints?.[table] && fingerprintRows(current) !== manifest.fingerprints[table]) throw new Error(`Showcase record drift: ${table}`);
    }
    async function ensure(key: string, table: string, filters: Record<string, string>, expected: Record<string, unknown>, create: () => Promise<void>) {
      let record = reconcileRecord(await rows(table, filters), manifest.ids[key], expected);
      if (!record) { if (verifyOnly) throw new Error(`Missing showcase ${key}`); await create(); await expect.poll(async () => (await rows(table, filters)).length, { timeout: 30_000 }).toBeGreaterThan(0); record = reconcileRecord(await rows(table, filters), undefined, expected); if (!record) throw new Error('Showcase creation did not persist the expected record'); }
      manifest.ids[key] = record.id; await persist(); return record;
    }
    let assessment = await ensure('assessment', 'assessment_sessions', {}, { created_by: user.id }, async () => {
      await page.goto('/app/assessment'); await submit('New assessment');
    });
    const qResult = await db.from('catalogue_questions').select('id,code,position').eq('catalogue_version_id', assessment.catalogue_version_id).order('position').order('id'); if (qResult.error || !qResult.data?.length) throw new Error('Missing assessment catalogue');
    const questions = qResult.data;
    const responses = await rows('assessment_responses', { session_id: assessment.id });
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i], answer = i === 0 ? 'partially' : 'yes';
      const current = responses.find((r) => r.question_id === q.id);
      if (current) { if (current.answer !== answer || current.evidence_note !== SPEC.note) throw new Error(`Assessment response drift: ${q.code}`); continue; }
      if (verifyOnly || assessment.state === 'completed') throw new Error(`Missing response: ${q.code}`);
      // Stay below the real application autosave limit, including larger catalogues.
      await new Promise((resolve) => setTimeout(resolve, 550));
      const response = await page.request.patch('/api/app/assessment/response', { data: { sessionId: assessment.id, questionId: q.id, answer, evidenceNote: SPEC.note, expectedRevision: assessment.revision } });
      if (!response.ok()) throw new Error(`Assessment save failed (${response.status()}): ${await response.text()}`);
      const body = await response.json(); assessment.revision = body.revision;
    }
    if (assessment.state !== 'completed') {
      if (verifyOnly) throw new Error('Assessment is incomplete');
      const response = await page.request.post('/api/app/assessment/complete', { data: { sessionId: assessment.id, expectedRevision: assessment.revision } }); if (!response.ok()) throw new Error(`Assessment completion failed: ${await response.text()}`);
      assessment = (await rows('assessment_sessions', { id: assessment.id }))[0];
    }
    const soa = await ensure('soa', 'soa_registers', {}, { assessment_session_id: assessment.id }, async () => {
      await page.goto('/app/soa'); await page.locator('select[name="assessmentId"]').selectOption(assessment.id); await submit('Generate draft');
    });
    const soaItems = await rows('soa_items', { soa_register_id: soa.id });
    const firstItem = soaItems.find((item) => /^(?:A\.)?5\.1$/.test(item.control_code)); if (!firstItem) throw new Error('Missing SoA items');
    const mapping = await db.from('requirement_control_mappings').select('control_id').eq('requirement_id', firstItem.control_id).limit(1); if (mapping.error || !mapping.data?.[0]) throw new Error('Missing SoA control mapping');
    const controlResult = await db.from('controls').select('id,code,title').eq('id', mapping.data[0].control_id); if (controlResult.error || !controlResult.data?.[0]) throw new Error('Missing control'); const control = controlResult.data[0];
    if (firstItem.justification !== SPEC.note || firstItem.owner_id !== user.id || firstItem.status !== 'in_progress') {
      if (verifyOnly || manifest.ids.soa_review) throw new Error('SoA review drift');
      await page.goto(`/app/soa/${soa.id}`); await page.getByRole('button', { name: `Review ${firstItem.control_code} ${firstItem.control_title}`, exact: true }).click();
      await page.getByRole('combobox', { name: 'Implementation status', exact: true }).selectOption('in_progress'); await page.getByLabel('Owner assignment').selectOption(user.id); await page.getByLabel('Rationale', { exact: true }).fill(SPEC.note); await submit('Save draft');
      await waitExpected('soa_items', { id: firstItem.id }, { justification: SPEC.note, owner_id: user.id, status: 'in_progress' });
      const saved = (await rows('soa_items', { id: firstItem.id }))[0]; reconcileRecord([saved], firstItem.id, { justification: SPEC.note, owner_id: user.id, status: 'in_progress' });
    }
    manifest.ids.soa_review = firstItem.id; await persist();
    const risk = await ensure('risk', 'risks', { reference: SPEC.riskRef }, { title: SPEC.riskTitle, owner_id: user.id, source_assessment_session_id: assessment.id }, async () => {
      await page.goto(`/app/risks/new?sourceAssessmentSessionId=${assessment.id}`);
      await page.getByLabel('Reference', { exact: true }).fill(SPEC.riskRef); await page.getByLabel('Title', { exact: true }).fill(SPEC.riskTitle); await page.getByLabel('Description', { exact: true }).fill(SPEC.note);
      await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption({ index: 1 }); await page.getByRole('combobox', { name: 'Owner', exact: true }).selectOption(user.id); await submit('Save risk');
    });
    const plan = await ensure('treatment', 'risk_treatment_plans', { reference: SPEC.planRef }, { risk_id: risk.id, assigned_lead_id: user.id, target_completion: SPEC.due }, async () => {
      await page.goto(`/app/risks/${risk.id}`); await page.getByLabel('Reference', { exact: true }).fill(SPEC.planRef); await page.getByLabel('Assigned lead').selectOption(user.id); await page.getByLabel('Control reference').selectOption(control.id); await page.getByLabel('Target completion').fill(SPEC.due); await page.getByLabel('Summary', { exact: true }).fill('Independent review of the fictional access review sample'); await page.getByLabel('Treatment measures').fill(SPEC.note); await page.getByLabel(/Also create an owned, dated task/).check(); await submit('Add treatment plan');
    });
    const task = await ensure('task', 'tasks', { title: `Treatment plan ${SPEC.planRef}` }, { owner_id: user.id, risk_id: risk.id, control_id: control.id, due_on: SPEC.due }, async () => { throw new Error('Treatment task missing; refuse to duplicate the plan'); });
    const evidence = await ensure('evidence', 'evidence', { title: SPEC.evidenceTitle }, { owner_id: user.id, kind: 'note', description: SPEC.note }, async () => {
      await page.goto('/app/evidence/new'); await page.getByLabel('Title', { exact: true }).fill(SPEC.evidenceTitle); await page.getByLabel('Kind').selectOption('note'); await page.getByLabel('Description', { exact: true }).fill(SPEC.note); await page.getByRole('combobox', { name: 'Owner', exact: true }).selectOption(user.id); await page.getByLabel('Collected on').fill('2026-09-05'); await page.getByLabel('Valid until').fill('2027-09-05'); await submit('Save evidence');
    });
    for (const [kind, target] of [['control', control.id], ['risk', risk.id], ['task', task.id]]) {
      await ensure(`evidence_${kind}`, 'evidence_links', { evidence_id: evidence.id, [`${kind}_id`]: target }, {}, async () => {
        await page.goto('/app/evidence'); const select = page.getByLabel(`Link ${SPEC.evidenceTitle} to a control`); await select.selectOption(`${kind}:${target}`); const form = select.locator('..'); await submitLocator(form.getByRole('button', { name: 'Link', exact: true }));
      });
    }
    const policy = await ensure('policy', 'policies', { reference: SPEC.policyRef }, { title: SPEC.policyTitle, owner_id: user.id, body: SPEC.note }, async () => {
      await page.goto('/app/policies/new'); await page.getByLabel('Reference', { exact: true }).fill(SPEC.policyRef); await page.getByLabel('Title', { exact: true }).fill(SPEC.policyTitle); await page.getByRole('combobox', { name: 'Owner', exact: true }).selectOption(user.id); await page.getByLabel('Review due').fill(SPEC.due); await page.getByLabel('Policy content').fill(SPEC.note); await submit('Create policy');
    });
    if (policy.status !== 'approved') { if (verifyOnly || policy.status !== 'draft') throw new Error('Policy status drift'); await page.goto(`/app/policies/${policy.id}`); await submit('Approve policy'); }
    await ensure('evidence_policy', 'evidence_links', { evidence_id: evidence.id, policy_id: policy.id }, {}, async () => { await page.goto(`/app/policies/${policy.id}`); await page.getByLabel('Link evidence to this policy').selectOption(evidence.id); await submit('Link'); });
    const audit = await ensure('audit', 'audits', { reference: SPEC.auditRef }, { title: SPEC.auditTitle, lead_auditor_id: user.id }, async () => {
      await page.goto('/app/audits/new'); await page.getByLabel('Reference', { exact: true }).fill(SPEC.auditRef); await page.getByLabel('Title', { exact: true }).fill(SPEC.auditTitle); await page.getByLabel('Lead auditor').selectOption(user.id); await page.getByLabel('Planned start').fill('2026-12-01'); await page.getByLabel('Planned end').fill(SPEC.due); await page.getByLabel('Scope', { exact: true }).fill(SPEC.note); await submit('Plan audit');
    });
    const checklist = await ensure('checklist', 'audit_checklist_items', { audit_id: audit.id, checklist_item: SPEC.checklist }, {}, async () => { await page.goto(`/app/audits/${audit.id}`); await page.getByLabel('Checklist item', { exact: true }).fill(SPEC.checklist); await submit('Add item'); });
    if (checklist.compliant !== 'non_compliant' || checklist.evidence_note !== SPEC.note) {
      if (verifyOnly || manifest.ids.checklist_review) throw new Error('Audit checklist drift');
      await page.goto(`/app/audits/${audit.id}`); const row = page.getByRole('row').filter({ hasText: SPEC.checklist }); await row.getByLabel(`Result for ${SPEC.checklist}`).selectOption('non_compliant'); await row.getByLabel(`Evidence for ${SPEC.checklist}`).fill(SPEC.note); await row.getByLabel(`Findings for ${SPEC.checklist}`).fill('Independent sign-off is pending; tracked in NS-RTP-001.'); await submitLocator(row.getByRole('button', { name: 'Save', exact: true }));
      await waitExpected('audit_checklist_items', { id: checklist.id }, { compliant: 'non_compliant', evidence_note: SPEC.note });
      reconcileRecord(await rows('audit_checklist_items', { id: checklist.id }), checklist.id, { compliant: 'non_compliant', evidence_note: SPEC.note });
    }
    manifest.ids.checklist_review = checklist.id; await persist();
    await ensure('finding', 'audit_findings', { audit_id: audit.id, summary: SPEC.riskTitle }, { severity: 'observation' }, async () => { await page.goto(`/app/audits/${audit.id}`); await page.getByLabel('Summary', { exact: true }).fill(SPEC.riskTitle); await page.getByLabel('Corrective action', { exact: true }).fill(`Follow the owned treatment plan ${SPEC.planRef}; no additional task is needed.`); await submit('Raise finding'); });
    const baselineTitle = 'Northstar fictional control baseline — Showcase v1';
    const baselineNote = 'FICTIONAL SIMULATION: Northstar reviewed the following control baseline for this showcase. All listed controls are demonstrated as operational except 5.1, where independent access-review sign-off is in progress under NS-R-001 and NS-RTP-001. This synthetic dossier is not real-world proof or certification.\r\n' + soaItems.sort((a, b) => a.position - b.position).map((item) => `${item.control_code}: ${item.control_title}`).join('\r\n');
    const baseline = await ensure('baseline_evidence', 'evidence', { title: baselineTitle }, { kind: 'note', owner_id: user.id, description: baselineNote }, async () => {
      await page.goto('/app/evidence/new'); await page.getByLabel('Title', { exact: true }).fill(baselineTitle); await page.getByLabel('Kind').selectOption('note'); await page.getByLabel('Description', { exact: true }).fill(baselineNote); await page.getByRole('combobox', { name: 'Owner', exact: true }).selectOption(user.id); await page.getByLabel('Collected on').fill('2026-09-05'); await page.getByLabel('Valid until').fill('2027-09-05'); await submit('Save evidence');
    });
    const allMappings = await db.from('requirement_control_mappings').select('requirement_id,control_id').in('requirement_id', soaItems.map((item) => item.control_id)); if (allMappings.error) throw allMappings.error;
    // Real browser native form submissions avoid hydration races in this repeatable evidence batch.
    const evidenceContext = await browser.newContext({ baseURL: site, storageState: await context.storageState(), javaScriptEnabled: false });
    const evidencePage = await evidenceContext.newPage();
    for (const item of soaItems) {
      const mapped = allMappings.data.find((entry) => entry.requirement_id === item.control_id); if (!mapped) throw new Error(`Missing evidence mapping for ${item.control_code}`);
      await ensure(`baseline_link_${mapped.control_id}`, 'evidence_links', { evidence_id: baseline.id, control_id: mapped.control_id }, {}, async () => {
        await evidencePage.goto('/app/evidence'); const select = evidencePage.getByLabel(`Link ${baselineTitle} to a control`); await select.selectOption(`control:${mapped.control_id}`);
        await Promise.all([evidencePage.waitForNavigation({ waitUntil: 'domcontentloaded' }), select.locator('..').getByRole('button', { name: 'Link', exact: true }).click()]);
      });
    }
    await evidenceContext.close();
    for (const item of await rows('soa_items', { soa_register_id: soa.id })) {
      const status = item.id === firstItem.id ? 'in_progress' : 'operational';
      const rationale = item.id === firstItem.id ? SPEC.note : `FICTIONAL SHOWCASE v1: ${item.control_code} ${item.control_title} applies to Northstar's information-security scope. The synthetic control baseline demonstrates this control as operational; the owner reviews it annually. This simulated decision is not certification or audit assurance.`;
      const expected = { status, applicable: true, owner_id: user.id, justification: rationale };
      const matches = Object.entries(expected).every(([key, value]) => item[key] === value);
      if (!matches) {
        if (verifyOnly || manifest.ids[`soa_review_${item.id}`]) throw new Error(`SoA decision drift: ${item.control_code}`);
        console.log(`Reviewing control ${item.control_code}`);
        await page.goto(`/app/soa/${soa.id}`); await page.getByRole('button', { name: `Review ${item.control_code} ${item.control_title}`, exact: true }).click();
        await expect(page.locator('.soa-detail-heading h2')).toHaveText(`${item.control_code} ${item.control_title}`);
        await page.getByRole('combobox', { name: 'Applicability decision', exact: true }).selectOption('true'); await page.getByRole('combobox', { name: 'Implementation status', exact: true }).selectOption(status); await page.getByRole('combobox', { name: 'Owner assignment', exact: true }).selectOption(user.id); await page.getByRole('textbox', { name: 'Rationale', exact: true }).fill(rationale); await submit('Save draft');
        await waitExpected('soa_items', { id: item.id }, expected);
        reconcileRecord(await rows('soa_items', { id: item.id }), item.id, expected);
      }
      manifest.ids[`soa_review_${item.id}`] = item.id; await persist();
    }
    const snapshot = await ensure('soa_snapshot', 'soa_snapshots', { soa_register_id: soa.id }, {}, async () => { await page.goto(`/app/soa/${soa.id}`); await submit(`Finalise immutable v${soa.version}`); });
    manifest.urls.soa_pdf = `${site}/api/app/soa/${snapshot.id}/pdf`;
    await ensure('report_snapshot', 'leadership_report_snapshots', {}, {}, async () => { await page.goto('/app/reports/readiness'); await submit('Publish to members'); });
    manifest.ids.control = control.id; manifest.ids.treatment = plan.id;
    for (const [key, route] of Object.entries({ dashboard: '/app', assessment: `/app/assessment/${assessment.id}`, soa: `/app/soa/${soa.id}`, risk: `/app/risks/${risk.id}`, task: `/app/tasks/${task.id}`, evidence: '/app/evidence', policy: `/app/policies/${policy.id}`, audit: `/app/audits/${audit.id}`, report: '/app/reports/readiness' })) manifest.urls[key] = site + route;
    manifest.fingerprints = {};
    for (const table of ['assessment_sessions', 'assessment_responses', 'soa_registers', 'soa_snapshots', 'soa_items', 'risks', 'risk_treatment_plans', 'tasks', 'evidence', 'evidence_links', 'policies', 'audits', 'audit_checklist_items', 'audit_findings', 'leadership_report_snapshots']) { const current = await rows(table); manifest.counts[table] = current.length; manifest.fingerprints[table] = fingerprintRows(current); }
    for (const [name, url] of Object.entries({ 'soa.pdf': `/api/app/soa/${snapshot.id}/pdf`, 'readiness-report.pdf': '/api/app/reports/readiness/pdf', 'audit-pack.csv': `/api/app/audits/${audit.id}/pack?format=csv`, 'risks.csv': '/api/app/risks/export?format=csv' })) {
      const response = await page.request.get(url); if (!response.ok()) throw new Error(`Export failed: ${name}`); const bytes = await response.body(); if (!bytes.length || (name.endsWith('.pdf') && bytes.subarray(0, 4).toString() !== '%PDF')) throw new Error(`Invalid export ${name}`); await writeFile(path.join(dir, name), bytes, { mode: 0o600 });
    }
    manifest.verifiedAt = new Date().toISOString(); await persist(); console.log(`Showcase ${verifyOnly ? 'verified' : 'prepared'}: ${manifestPath}`);
  } finally { await browser?.close(); await release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { console.error(error instanceof Error ? error.message : 'Showcase failed'); process.exitCode = 1; });
