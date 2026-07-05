import { describe, expect, it } from "vitest";
import { ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL, summariseAssets } from "./assets";

describe("asset enums", () => {
  it("labels every classification and value in en-GB", () => {
    expect(ASSET_CLASSIFICATION_LABEL.highly_confidential).toBe("Highly Confidential");
    expect(ASSET_CLASSIFICATION_LABEL.internal_use_only).toBe("Internal Use Only");
    expect(ASSET_VALUE_LABEL.high).toBe("High");
  });
});

describe("summariseAssets", () => {
  it("counts totals, high-value and highly-confidential assets", () => {
    const s = summariseAssets([
      { classification: "highly_confidential", value_criticality: "high" },
      { classification: "public", value_criticality: "low" },
      { classification: "confidential", value_criticality: "high" },
    ]);
    expect(s).toEqual({ total: 3, highValue: 2, sensitive: 1 });
  });
});
