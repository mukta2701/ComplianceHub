import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("application font loading", () => {
  it("uses only local browser font stacks so production builds do not fetch Google Fonts", () => {
    const layout = read("src/app/layout.tsx");
    const styles = read("src/app/globals.css");

    expect(layout).not.toContain("next/font/google");
    expect(layout).not.toContain("next/font/local");
    expect(layout).not.toContain("--font-geist-");
    expect(styles).not.toContain("--font-geist-");
    expect(styles).toContain("font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif");
    expect(styles).toContain("font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,\"Liberation Mono\",\"Courier New\",monospace");
  });
});
