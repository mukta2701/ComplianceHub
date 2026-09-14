import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ accept: vi.fn(), approve: vi.fn(), status: vi.fn() }));
vi.mock("./policy-decision-actions", () => ({ submitPolicyAcceptanceAction: mocks.accept, submitPolicyApprovalAction: mocks.approve, submitPolicyStatusAction: mocks.status }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
import { PolicyAcceptanceForm } from "./policy-decision-forms";

it("keeps the policy page usable when an acceptance response is interrupted", async () => {
  mocks.accept.mockRejectedValueOnce(new Error("Connection interrupted"));
  render(<PolicyAcceptanceForm id="78000000-0000-4000-8000-000000000001" version={3} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "I accept this policy" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not confirm whether acceptance was recorded");
  expect(screen.getByRole("button", { name: "I accept this policy" })).toBeEnabled();
});
