import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import Risks from "./page";

describe("demo risk register", () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
    }});
  });

  it("opens an accessible dialog, closes it with Escape, and restores focus", async () => {
    const user = userEvent.setup();
    render(<Risks />);
    const opener = screen.getByRole("button", { name: "Add a risk" });
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: "Add a risk" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close risk editor" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("persists complete risk details and can safely reset demo data", async () => {
    const user = userEvent.setup();
    render(<Risks />);
    await user.click(screen.getByRole("button", { name: "Add a risk" }));
    await user.type(screen.getByLabelText("Risk description"), "Laptop is lost while travelling");
    await user.type(screen.getByLabelText("Owner"), "Mia Chen");
    await user.selectOptions(screen.getByLabelText("Likelihood"), "4");
    await user.selectOptions(screen.getByLabelText("Impact"), "4");
    await user.selectOptions(screen.getByLabelText("Treatment"), "Mitigate");
    await user.type(screen.getByLabelText("Evidence or notes"), "Device encryption is enabled.");
    await user.click(screen.getByRole("button", { name: "Add risk" }));
    expect(screen.getByText("Laptop is lost while travelling")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("compliancehub-demo-risks") ?? "[]")).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Laptop is lost while travelling", l: 4, i: 4, treatment: "Mitigate" })]));
    await user.click(screen.getByRole("button", { name: "Reset demo data" }));
    expect(screen.getByRole("alertdialog", { name: "Reset demo risk data?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yes, reset demo" }));
    expect(screen.queryByText("Laptop is lost while travelling")).not.toBeInTheDocument();
  });
});
