import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeading } from "./page-heading";
import { PageIntro } from "./ui";

describe("PageHeading", () => {
  it("renders a semantic page header with a visible h1 and body", () => {
    const { container } = render(
      <PageHeading title="Risk register" body="Track and review current exposure." />,
    );

    expect(container.querySelector("header.page-heading")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Risk register" })).toBeVisible();
    expect(screen.getByText("Track and review current exposure.")).toBeVisible();
  });

  it("renders optional eyebrow, metadata, and one action region", () => {
    render(
      <PageHeading
        eyebrow="RISK"
        title="Risk register"
        body="Track and review current exposure."
        metadata={<span>Updated today</span>}
        action={<button type="button">Add risk</button>}
      />,
    );

    expect(screen.getByText("RISK")).toBeVisible();
    expect(screen.getByText("Updated today")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add risk" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add risk" }).parentElement).toHaveClass(
      "page-heading__action",
    );
  });
});

describe("PageIntro compatibility", () => {
  it("maps the existing props to PageHeading output", () => {
    render(
      <PageIntro
        eyebrow="EVIDENCE"
        title="Evidence vault"
        body="Keep proof current and reviewable."
        action={<a href="/app/evidence/new">Add evidence</a>}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Evidence vault" })).toBeVisible();
    expect(screen.getByText("EVIDENCE")).toBeVisible();
    expect(screen.getByText("Keep proof current and reviewable.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Add evidence" })).toHaveAttribute(
      "href",
      "/app/evidence/new",
    );
  });
});
