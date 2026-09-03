import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import MonitoringError from "./error";
import MonitoringLoading from "./loading";

describe("Monitoring route boundaries", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a route-local loading surface with safe status semantics", () => {
    render(<MonitoringLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading monitoring status…");
    expect(screen.getByRole("heading", { name: "Loading monitoring" })).toBeVisible();
  });

  it("shows safe error copy and retries without exposing the error", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<MonitoringError error={new Error("provider-secret-detail")} reset={retry} />);
    expect(screen.getByRole("heading", { name: "Monitoring could not be loaded" })).toBeVisible();
    expect(screen.queryByText("provider-secret-detail")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("reports only the error digest and tolerates observability failure", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("observability unavailable"));
    vi.stubGlobal("fetch", fetch);

    render(<MonitoringError
      error={Object.assign(new Error("provider-secret-detail"), { digest: "safe-digest" })}
      reset={vi.fn()}
    />);

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith("/api/observability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ digest: "safe-digest" }),
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("provider-secret-detail");
    expect(screen.queryByText("provider-secret-detail")).not.toBeInTheDocument();
  });
});
