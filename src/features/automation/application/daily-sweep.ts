import {
  planEvidenceTransitions, planExpiryTasks, planOverdueTaskAlerts,
  type SweepEvidence, type SweepTask,
} from "../domain/sweep";

export type NewExpiryTask = { organisationId: string; evidenceId: string; title: string; ownerId: string | null; dueOn: string | null };
export type NewNotification = { organisationId: string; userId: string; kind: string; subjectType: string; subjectId: string; message: string; sweepOn: string };
export type SweepSummary = { evidenceExpiring: number; evidenceExpired: number; tasksCreated: number; notificationsCreated: number };

export type SweepDependencies = {
  today: string;
  listActiveEvidence: () => Promise<SweepEvidence[]>;
  updateEvidenceStatus: (id: string, status: "expiring" | "expired") => Promise<void>;
  listOpenExpiryTaskEvidenceIds: () => Promise<string[]>;
  createTask: (task: NewExpiryTask) => Promise<boolean>;
  listOverdueTasks: () => Promise<SweepTask[]>;
  listOrganisationOwners: (organisationId: string) => Promise<string[]>;
  createNotification: (notification: NewNotification) => Promise<boolean>;
};

async function recipients(ownerId: string | null, organisationId: string, deps: SweepDependencies): Promise<string[]> {
  return ownerId ? [ownerId] : deps.listOrganisationOwners(organisationId);
}

export async function runDailySweep(deps: SweepDependencies): Promise<SweepSummary> {
  const summary: SweepSummary = { evidenceExpiring: 0, evidenceExpired: 0, tasksCreated: 0, notificationsCreated: 0 };
  const evidence = await deps.listActiveEvidence();

  for (const transition of planEvidenceTransitions(evidence, deps.today)) {
    await deps.updateEvidenceStatus(transition.evidenceId, transition.to);
    summary[transition.to === "expiring" ? "evidenceExpiring" : "evidenceExpired"] += 1;
    for (const userId of await recipients(transition.ownerId, transition.organisationId, deps)) {
      const inserted = await deps.createNotification({
        organisationId: transition.organisationId, userId, kind: `evidence_${transition.to}`,
        subjectType: "evidence", subjectId: transition.evidenceId,
        message: `Evidence "${transition.title}" is ${transition.to === "expiring" ? "expiring soon" : "expired"}.`.slice(0, 500), sweepOn: deps.today,
      });
      if (inserted) summary.notificationsCreated += 1;
    }
  }

  const openExpiryIds = await deps.listOpenExpiryTaskEvidenceIds();
  for (const task of planExpiryTasks(evidence, openExpiryIds, deps.today)) {
    if (await deps.createTask(task)) {
      summary.tasksCreated += 1;
      const item = evidence.find((candidate) => candidate.id === task.evidenceId);
      // Evidence created after its validity date is already `expired`, so it
      // has no status transition to generate the normal expiry notification.
      if (item?.status === "expired") {
        for (const userId of await recipients(item.ownerId, item.organisationId, deps)) {
          const inserted = await deps.createNotification({
            organisationId: item.organisationId, userId, kind: "evidence_expired",
            subjectType: "evidence", subjectId: item.id,
            message: `Evidence "${item.title}" is expired.`.slice(0, 500), sweepOn: deps.today,
          });
          if (inserted) summary.notificationsCreated += 1;
        }
      }
    }
  }

  for (const alert of planOverdueTaskAlerts(await deps.listOverdueTasks(), deps.today)) {
    for (const userId of await recipients(alert.ownerId, alert.organisationId, deps)) {
      const inserted = await deps.createNotification({
        organisationId: alert.organisationId, userId, kind: "task_overdue",
        subjectType: "tasks", subjectId: alert.taskId,
        message: `Task "${alert.title}" is overdue.`.slice(0, 500), sweepOn: deps.today,
      });
      if (inserted) summary.notificationsCreated += 1;
    }
  }
  return summary;
}
