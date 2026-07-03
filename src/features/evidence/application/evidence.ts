import { z } from "zod";

export const MAX_EVIDENCE_FILE_BYTES = 26_214_400; // 25 MB, mirrors the bucket limit
export const ALLOWED_EVIDENCE_MIME_TYPES = [
  "application/pdf", "image/png", "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv", "text/plain",
] as const;

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional()
  .transform((value) => (value ? value : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional()
  .transform((value) => (value ? value : null));

export const evidenceInputSchema = z.object({
  organisationId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["file", "link", "note"]),
  url: z.union([z.url(), z.literal("")]).optional().transform((value) => (value ? value : null)),
  description: z.string().max(10_000).default(""),
  ownerId: optionalUuid,
  collectedOn: optionalDate,
  validUntil: optionalDate,
  reviewInterval: z.union([z.enum(["weekly", "monthly", "quarterly", "semiannually", "annually"]), z.literal("")]).optional()
    .transform((value) => (value ? value : null)),
  replacesEvidenceId: optionalUuid,
}).refine((value) => value.kind !== "link" || value.url !== null, { message: "Link evidence requires a URL" });
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;

export async function persistEvidenceWithCompensation(
  payload: Record<string, unknown> & { storagePath: string | null },
  deps: { createRecord: (payload: Record<string, unknown>) => Promise<string>; removeUpload: (path: string) => Promise<void> },
) {
  try { return await deps.createRecord(payload); }
  catch (error) {
    if (payload.storagePath) await deps.removeUpload(payload.storagePath);
    throw error;
  }
}
