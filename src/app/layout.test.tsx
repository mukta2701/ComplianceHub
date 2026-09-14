import { describe, expect, it } from "vitest";
import RootLayout from "./layout";

describe("root layout", () => {
  it("declares the intentional smooth-scroll behavior for Next.js route transitions", () => {
    const layout = RootLayout({ children: <main>Content</main> });
    expect(layout.props["data-scroll-behavior"]).toBe("smooth");
  });
});
