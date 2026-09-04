import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Assessment from "./page";

describe("demo assessment", () => {
  it("ends with a review and completion state", async () => {
    const user = userEvent.setup();
    render(<Assessment />);

    for (let step = 0; step < 9; step += 1) {
      await user.click(screen.getByRole("button", { name: /Next question/ }));
    }
    await user.click(screen.getByRole("button", { name: /Review answers/ }));

    expect(screen.getByRole("heading", { name: "Review your answers" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Finish assessment" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Finish assessment" }));
    expect(screen.getByRole("heading", { name: "Assessment complete" })).toBeVisible();
    expect(screen.getByRole("link", { name: "View your readiness" })).toHaveAttribute("href", "/demo/dashboard");
  });
});
