import { notFound } from "next/navigation";
import { PageIntro } from "@/components/ui";
import { summariseEvidenceFreshness, type EvidenceKind, type EvidenceStatus } from "@/features/evidence/domain/evidence";
import {
  deriveSoaReviewState,
  summariseSoaQueue,
  type SoaDomain,
} from "@/features/soa/application/review-queue";
import { SOA_STATUS_LABEL, type SoaStatus } from "@/features/soa/domain/soa";
import type { TaskStatus } from "@/features/tasks/domain/tasks";
import { requireAppContext } from "@/lib/app-context";
import { one } from "@/lib/supabase/one";
import { finaliseSoaAction, reviewSoaItemAction } from "../../actions";
import { SoaReviewWorkspace, type SoaReviewWorkspaceItem } from "./soa-review-workspace";

const SOA_DOMAINS = new Set<SoaDomain>(["organisational", "people", "physical", "technological"]);

function isSoaDomain(value: unknown): value is SoaDomain {
  return typeof value === "string" && SOA_DOMAINS.has(value as SoaDomain);
}

function isSoaStatus(value: unknown): value is SoaStatus {
  return typeof value === "string" && value in SOA_STATUS_LABEL;
}

export default async function SoaReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, organisation } = await requireAppContext();
  const { data: register, error: registerError } = await supabase
    .from("soa_registers")
    .select("id,title,version")
    .eq("id", id)
    .eq("organisation_id", organisation.id)
    .single();

  if (registerError || !register) notFound();

  const [itemResult, memberResult] = await Promise.all([
    supabase
      .from("soa_items")
      .select("id,control_id,control_code,control_title,applicable,status,justification,evidence,owner_id,position")
      .eq("soa_register_id", id)
      .eq("organisation_id", organisation.id)
      .order("position"),
    supabase
      .from("memberships")
      .select("user_id,profiles(display_name)")
      .eq("organisation_id", organisation.id),
  ]);

  if (itemResult.error || memberResult.error) throw new Error("Could not load the SoA review queue");

  const itemRows = itemResult.data ?? [];
  const itemIds = itemRows.map((item) => item.id);
  const requirementIds = itemRows.map((item) => item.control_id).filter((value): value is string => Boolean(value));
  const domainByRequirement = new Map<string, SoaDomain>();
  const linkedEvidenceByRequirement = new Map<string, SoaReviewWorkspaceItem["linkedEvidence"]>();
  const linkedTasksByRequirement = new Map<string, SoaReviewWorkspaceItem["linkedTasks"]>();
  const auditEventsByItem = new Map<string, SoaReviewWorkspaceItem["recentAuditEvents"]>();

  if (itemIds.length) {
    const { data: auditEvents, error: auditError } = await supabase
      .from("audit_events")
      .select("entity_id,action,occurred_at")
      .eq("organisation_id", organisation.id)
      .eq("entity_type", "soa_items")
      .in("entity_id", itemIds)
      .order("occurred_at", { ascending: false })
      .limit(500);
    if (auditError) throw new Error("Could not load SoA item history");
    for (const event of auditEvents ?? []) {
      const events = auditEventsByItem.get(event.entity_id) ?? [];
      if (events.length >= 5) continue;
      events.push({ action: event.action, occurredAt: event.occurred_at });
      auditEventsByItem.set(event.entity_id, events);
    }
  }

  if (requirementIds.length) {
    const [catalogueResult, mappingResult] = await Promise.all([
      supabase.from("control_catalogue_controls").select("id,theme").in("id", requirementIds),
      supabase.from("requirement_control_mappings").select("requirement_id,control_id").in("requirement_id", requirementIds),
    ]);
    if (catalogueResult.error || mappingResult.error) throw new Error("Could not load SoA control mappings");

    for (const control of catalogueResult.data ?? []) {
      if (!isSoaDomain(control.theme)) throw new Error("Control catalogue contains an invalid theme");
      domainByRequirement.set(control.id, control.theme);
    }

    const controlsByRequirement = new Map<string, Set<string>>();
    for (const mapping of mappingResult.data ?? []) {
      const controls = controlsByRequirement.get(mapping.requirement_id) ?? new Set<string>();
      controls.add(mapping.control_id);
      controlsByRequirement.set(mapping.requirement_id, controls);
    }

    const sharedControlIds = [...new Set([...controlsByRequirement.values()].flatMap((controls) => [...controls]))];
    const tasksByControl = new Map<string, Map<string, SoaReviewWorkspaceItem["linkedTasks"][number]>>();
    const evidenceByControl = new Map<string, Map<string, SoaReviewWorkspaceItem["linkedEvidence"][number]>>();

    if (sharedControlIds.length) {
      const [taskResult, evidenceResult] = await Promise.all([
        supabase
          .from("tasks")
          .select("id,control_id,title,status,due_on")
          .eq("organisation_id", organisation.id)
          .in("status", ["open", "in_progress"])
          .in("control_id", sharedControlIds),
        supabase
          .from("evidence_links")
          .select("evidence_id,control_id,evidence(id,title,status,valid_until,kind)")
          .eq("organisation_id", organisation.id)
          .in("control_id", sharedControlIds),
      ]);
      if (taskResult.error || evidenceResult.error) throw new Error("Could not load SoA evidence and linked work");

      for (const task of taskResult.data ?? []) {
        if (!task.control_id) continue;
        const controlTasks = tasksByControl.get(task.control_id) ?? new Map<string, SoaReviewWorkspaceItem["linkedTasks"][number]>();
        controlTasks.set(task.id, {
          id: task.id,
          title: task.title,
          status: task.status as TaskStatus,
          dueOn: task.due_on,
        });
        tasksByControl.set(task.control_id, controlTasks);
      }
      for (const link of evidenceResult.data ?? []) {
        if (!link.control_id) continue;
        const evidence = one(link.evidence);
        if (!evidence) continue;
        const controlEvidence = evidenceByControl.get(link.control_id) ?? new Map<string, SoaReviewWorkspaceItem["linkedEvidence"][number]>();
        controlEvidence.set(link.evidence_id, {
          id: evidence.id,
          title: evidence.title,
          status: evidence.status as EvidenceStatus,
          validUntil: evidence.valid_until,
          kind: evidence.kind as EvidenceKind,
        });
        evidenceByControl.set(link.control_id, controlEvidence);
      }
    }

    for (const requirementId of requirementIds) {
      const evidence = new Map<string, SoaReviewWorkspaceItem["linkedEvidence"][number]>();
      const tasks = new Map<string, SoaReviewWorkspaceItem["linkedTasks"][number]>();
      for (const controlId of controlsByRequirement.get(requirementId) ?? []) {
        for (const [evidenceId, record] of evidenceByControl.get(controlId) ?? []) evidence.set(evidenceId, record);
        for (const [taskId, record] of tasksByControl.get(controlId) ?? []) tasks.set(taskId, record);
      }
      linkedEvidenceByRequirement.set(requirementId, [...evidence.values()]);
      linkedTasksByRequirement.set(requirementId, [...tasks.values()]);
    }
  }

  const memberOptions = (memberResult.data ?? []).map((member) => {
    const profile = one(member.profiles);
    return { id: member.user_id, name: profile?.display_name ?? member.user_id };
  });
  const ownerNameById = new Map(memberOptions.map((member) => [member.id, member.name]));

  const queueItems: SoaReviewWorkspaceItem[] = itemRows.map((item) => {
    const controlId = item.control_id;
    const domain = domainByRequirement.get(controlId);
    if (!domain) throw new Error("SoA item is missing its authoritative control theme");
    if (!isSoaStatus(item.status)) throw new Error("SoA item contains an invalid status");
    const linkedEvidence = linkedEvidenceByRequirement.get(controlId) ?? [];
    const linkedTasks = linkedTasksByRequirement.get(controlId) ?? [];
    const freshness = summariseEvidenceFreshness(linkedEvidence);
    const projected = {
      id: item.id,
      controlId,
      code: item.control_code,
      title: item.control_title,
      domain,
      applicable: item.applicable,
      status: item.status,
      justification: item.justification,
      evidenceText: item.evidence,
      ownerId: item.owner_id,
      ownerName: item.owner_id ? ownerNameById.get(item.owner_id) ?? item.owner_id : null,
      evidenceTotal: freshness.total,
      evidenceExpiring: freshness.expiring,
      evidenceExpired: freshness.expired,
      openTaskCount: linkedTasks.length,
      position: item.position,
      linkedEvidence,
      linkedTasks,
      recentAuditEvents: auditEventsByItem.get(item.id) ?? [],
    };
    return { ...projected, reviewState: deriveSoaReviewState(projected) };
  });

  const summary = summariseSoaQueue(queueItems);
  const canFinalise = summary.total > 0 && summary.needsAttention === 0;
  const preflight = summary.total === 0
    ? "No controls are available for review."
    : `${summary.needsAttention} need attention: ${summary.missingRationale} missing rationale, ${summary.evidenceGaps} evidence gaps, ${summary.unassigned} unassigned, ${summary.undecided} undecided.`;

  return <>
    <PageIntro
      eyebrow={`SOA REVIEW - DRAFT V${register.version}`}
      title={register.title}
      body={canFinalise ? `Preflight complete. All ${summary.total} controls have been reviewed.` : preflight}
      action={canFinalise ? (
        <form action={finaliseSoaAction}>
          <input type="hidden" name="registerId" value={id} />
          <button className="button primary">Finalise immutable v{register.version}</button>
        </form>
      ) : (
        <a className="button secondary" href="#soa-review-blockers">Review {summary.needsAttention} attention items</a>
      )}
    />
    <SoaReviewWorkspace
      items={queueItems}
      members={memberOptions}
      currentUserId={user.id}
      saveAction={reviewSoaItemAction}
    />
  </>;
}
