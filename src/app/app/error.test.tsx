import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AppError from "./error";

afterEach(() => vi.unstubAllGlobals());

it("requests fresh server content when the operator tries again", () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  const boundary = { error: new Error("Unavailable data"), reset: vi.fn(), retry: vi.fn() };
  render(<AppError {...boundary} />);

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));

  expect(boundary.retry).toHaveBeenCalledOnce();
  expect(boundary.reset).not.toHaveBeenCalled();
});
