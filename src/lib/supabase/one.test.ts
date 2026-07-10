import { describe, expect, it } from "vitest";
import { one } from "./one";

describe("one", () => {
  it("normalizes Supabase embedded relations", () => {
    expect(one([{ id: "a" }, { id: "b" }])).toEqual({ id: "a" });
    expect(one({ id: "a" })).toEqual({ id: "a" });
    expect(one([])).toBeNull();
    expect(one(null)).toBeNull();
    expect(one(undefined)).toBeNull();
  });
});
