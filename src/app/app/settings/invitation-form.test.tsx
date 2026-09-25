import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  invite: vi.fn(),
}));

vi.mock("../actions", () => ({ inviteMemberAction: hoisted.invite }));

import { InvitationForm } from "./invitation-form";

describe("InvitationForm", () => {
  beforeEach(() => {
    hoisted.invite.mockReset();
    vi.restoreAllMocks();
  });

  it("shows a newly issued link once and copies it", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const invitationPath = "/invite/one-time-token";
    const invitationUrl = new URL(invitationPath, window.location.origin).toString();
    hoisted.invite.mockResolvedValue({
      invitationId: "30000000-0000-4000-8000-000000000003",
      email: "member@example.com",
      expiresAt: "2026-09-29T12:00:00.000Z",
      invitationPath,
    });
    render(<InvitationForm canInviteAdmin />);

    await user.type(screen.getByRole("textbox", { name: "Invite by email" }), "member@example.com");
    await user.click(screen.getByRole("button", { name: "Create invite" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Copy this invitation link now");
    expect(screen.getByDisplayValue(invitationUrl)).toBeVisible();
    expect(window.location.href).not.toContain("one-time-token");

    await user.click(screen.getByRole("button", { name: "Copy invitation link" }));
    expect(writeText).toHaveBeenCalledWith(invitationUrl);
    expect(await screen.findByText("Copied. The link is no longer shown here.")).toBeVisible();
    expect(screen.queryByDisplayValue(invitationUrl)).not.toBeInTheDocument();
  });

  it("clears the current result before creating another invitation", async () => {
    const user = userEvent.setup();
    hoisted.invite
      .mockResolvedValueOnce({ invitationId: "invite-1", email: "first@example.com", expiresAt: "2026-09-29T12:00:00.000Z", invitationPath: "/invite/first-token" })
      .mockImplementationOnce(() => new Promise(() => undefined));
    render(<InvitationForm canInviteAdmin={false} />);

    const email = screen.getByRole("textbox", { name: "Invite by email" });
    await user.type(email, "first@example.com");
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    const firstUrl = new URL("/invite/first-token", window.location.origin).toString();
    expect(await screen.findByDisplayValue(firstUrl)).toBeVisible();

    await user.clear(email);
    await user.type(email, "second@example.com");
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    await waitFor(() => expect(screen.queryByDisplayValue(firstUrl)).not.toBeInTheDocument());
  });

  it("keeps the link available for manual selection when clipboard access fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("clipboard unavailable"));
    const invitationPath = "/invite/manual-token";
    const invitationUrl = new URL(invitationPath, window.location.origin).toString();
    hoisted.invite.mockResolvedValue({ invitationId: "invite-1", email: "member@example.com", expiresAt: "2026-09-29T12:00:00.000Z", invitationPath });
    render(<InvitationForm canInviteAdmin={false} />);

    await user.type(screen.getByRole("textbox", { name: "Invite by email" }), "member@example.com");
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    await user.click(await screen.findByRole("button", { name: "Copy invitation link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed. Select the link and copy it manually.");
    expect(screen.getByDisplayValue(invitationUrl)).toBeVisible();
  });

  it("exposes readable invite controls with stable labels, placeholders and autocomplete", () => {
    render(<InvitationForm canInviteAdmin />);

    const email = screen.getByRole("textbox", { name: "Invite by email" });
    expect(email).toHaveAttribute("placeholder", "member@example.com");
    expect(email).toHaveAttribute("autocomplete", "email");

    const jobTitle = screen.getByRole("textbox", { name: "Job title" });
    expect(jobTitle.getAttribute("placeholder") ?? "").not.toHaveLength(0);

    expect(screen.getByRole("combobox", { name: "Role" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Create invite" })).toBeVisible();
  });
});
