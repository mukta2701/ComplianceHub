import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Settings from "./page";

describe("demo settings", () => {
  it("makes workspace save and team controls visibly respond", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("status")).toHaveTextContent("Workspace details saved in this demo.");
    await user.click(screen.getByRole("button", { name: "Invite member" }));
    expect(screen.getByRole("status")).toHaveTextContent("Invitations are available in a live workspace.");
  });
});
