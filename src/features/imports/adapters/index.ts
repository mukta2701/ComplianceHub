import { riskAdapter } from "./risk";
import { soaAdapter } from "./soa";
import { assetAdapter } from "./asset";
import type { ImportAdapter, ImportModule } from "../mapping";

export type { ImportAdapter, ImportModule };
export const ADAPTERS: Record<ImportModule, ImportAdapter> = { risk: riskAdapter, soa: soaAdapter, asset: assetAdapter };
