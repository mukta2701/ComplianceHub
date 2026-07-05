export type AssetClassification = "highly_confidential" | "confidential" | "internal_use_only" | "public";
export type AssetValue = "high" | "medium" | "low";

export const ASSET_CLASSIFICATION_LABEL: Record<AssetClassification, string> = {
  highly_confidential: "Highly Confidential", confidential: "Confidential", internal_use_only: "Internal Use Only", public: "Public",
};
export const ASSET_VALUE_LABEL: Record<AssetValue, string> = { high: "High", medium: "Medium", low: "Low" };
export const CLASSIFICATION_TONE: Record<AssetClassification, string> = {
  highly_confidential: "critical", confidential: "red", internal_use_only: "amber", public: "green",
};
export const VALUE_TONE: Record<AssetValue, string> = { high: "red", medium: "amber", low: "green" };

export function summariseAssets(assets: readonly { classification: AssetClassification; value_criticality: AssetValue }[]): { total: number; highValue: number; sensitive: number } {
  return {
    total: assets.length,
    highValue: assets.filter((a) => a.value_criticality === "high").length,
    sensitive: assets.filter((a) => a.classification === "highly_confidential").length,
  };
}
