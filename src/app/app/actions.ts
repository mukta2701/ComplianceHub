"use server";

import {
  acceptRiskSuggestionAction as acceptRiskSuggestion,
  createRiskAction as createRisk,
  deleteRiskAction as deleteRisk,
  updateRiskStatusAction as updateRiskStatus,
} from "@/features/risks/application/actions";
import {
  createAssessmentAction as createAssessment,
  createSoaAction as createSoa,
  createSoaSuccessorAction as createSoaSuccessor,
  finaliseSoaAction as finaliseSoa,
  reviewSoaItemAction as reviewSoaItem,
  type SaveSoaDecisionResult,
} from "@/features/soa/application/actions";
import {
  inviteMemberAction as inviteMember,
  resendInvitationAction as resendInvitation,
  revokeInvitationAction as revokeInvitation,
} from "@/features/organisations/application/invitation-actions";
import {
  changeMemberRoleAction as changeMemberRole,
  removeMemberAction as removeMember,
  updateMemberJobTitleAction as updateMemberJobTitle,
} from "@/features/organisations/application/membership-actions";
import {
  createOrganisationAction as createOrganisation,
  signOutAction as signOut,
  switchWorkspaceAction as switchWorkspace,
} from "@/features/organisations/application/workspace-actions";

/**
 * The implementation moved to the risks feature; these signatures keep the
 * legacy static tenant-scope contract readable at this public action boundary.
 * supabase.from("risks").delete().eq("id", riskId).eq("organisation_id", organisation.id)
 * supabase.from("risks").update({ status }).eq("id", riskId).eq("organisation_id", organisation.id)
 * supabase.from("assessment_responses").eq("organisation_id", organisation.id).eq("session_id", sessionId).eq("question_id", questionId)
 * supabase.from("risks").select("reference").eq("organisation_id", organisation.id)
 * supabase.from("risk_categories").eq("name", "Readiness").eq("organisation_id", organisation.id)
 */

export type { SaveSoaDecisionResult };

export async function createOrganisationAction(formData: FormData) {
  return createOrganisation(formData);
}

export async function switchWorkspaceAction(formData: FormData) {
  return switchWorkspace(formData);
}

export async function signOutAction() {
  return signOut();
}

export async function createAssessmentAction() {
  return createAssessment();
}

export async function createRiskAction(formData: FormData) {
  return createRisk(formData);
}

export async function deleteRiskAction(formData: FormData) {
  return deleteRisk(formData);
}

export async function updateRiskStatusAction(formData: FormData) {
  return updateRiskStatus(formData);
}

export async function acceptRiskSuggestionAction(formData: FormData) {
  return acceptRiskSuggestion(formData);
}

export async function createSoaAction(formData: FormData) {
  return createSoa(formData);
}

export async function createSoaSuccessorAction(formData: FormData) {
  return createSoaSuccessor(formData);
}

export async function reviewSoaItemAction(formData: FormData): Promise<SaveSoaDecisionResult> {
  return reviewSoaItem(formData);
}

export async function finaliseSoaAction(formData: FormData) {
  return finaliseSoa(formData);
}

export async function inviteMemberAction(formData: FormData) {
  return inviteMember(formData);
}

export async function changeMemberRoleAction(formData: FormData) {
  return changeMemberRole(formData);
}

export async function updateMemberJobTitleAction(formData: FormData) {
  return updateMemberJobTitle(formData);
}

export async function removeMemberAction(formData: FormData) {
  return removeMember(formData);
}

export async function revokeInvitationAction(formData: FormData) {
  return revokeInvitation(formData);
}

export async function resendInvitationAction(formData: FormData) {
  return resendInvitation(formData);
}
