import { z } from "zod";

export const ACTIVE_ORGANISATION_COOKIE = "compliancehub_active_organisation";
export const ACTIVE_ORGANISATION_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export function parseActiveOrganisationId(value: string | undefined): string | null {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}
