import { render,screen,waitFor } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";
import { AuditorLinkFlash } from "./auditor-link-flash";

describe("AuditorLinkFlash", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the one-time auditor link returned by the protected endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:true,
      json:() => Promise.resolve({ link:"https://compliance.example/audit-view/secret" }),
    }));

    render(<AuditorLinkFlash auditId="audit-1" />);

    expect(await screen.findByText("https://compliance.example/audit-view/secret")).toBeInTheDocument();
  });

  it("warns the owner when the active link cannot be delivered", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok:false }));

    render(<AuditorLinkFlash auditId="audit-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/revoke the active link listed below/i);
  });

  it("warns the owner when the link request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(<AuditorLinkFlash auditId="audit-1" />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/create a new one/i));
  });
});
