import { beforeEach, expect, it, vi } from "vitest";
import { policyInputSchema } from "@/features/policies/application/policy";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./actions", () => ({ createPolicyAction: mocks.create }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
import { createPolicyFormAction } from "./policy-create-actions";

beforeEach(() => vi.clearAllMocks());

it("returns field errors for a deterministic validation rejection", async () => {
  let validationError: unknown;
  try { policyInputSchema.parse({ organisationId: "78000000-0000-4000-8000-000000000003", reference: "   ", title: "   ", body: "" }); }
  catch (error) { validationError = error; }
  mocks.create.mockRejectedValueOnce(validationError);
  const result = await createPolicyFormAction({}, new FormData());
  expect(result.error).toContain("highlighted fields");
  expect(result.fieldErrors?.reference).toBeTruthy();
  expect(result.fieldErrors?.title).toBeTruthy();
});

it("returns a definite retry message when the database rejects creation", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Could not create the policy"));
  await expect(createPolicyFormAction({}, new FormData())).resolves.toEqual({ error: "Could not create the policy. Your entries are still shown; check them and try again." });
});
