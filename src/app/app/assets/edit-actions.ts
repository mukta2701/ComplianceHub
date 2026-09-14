"use server";

import { z } from "zod";
import { createAssetAction, updateAssetAction } from "./actions";

export type AssetFormState = { error?: string; fieldErrors?: Record<string, string[] | undefined>; conflict?: boolean };

function validationState(error: z.ZodError): AssetFormState {
  return { error: "Check the highlighted fields and try again.", fieldErrors: error.flatten().fieldErrors };
}

export async function createAssetFormAction(_previous: AssetFormState, formData: FormData): Promise<AssetFormState> {
  try {
    await createAssetAction(formData);
    return {};
  } catch (error) {
    if (error instanceof z.ZodError) return validationState(error);
    if (error instanceof Error && error.message === "Could not save the asset") return { error: "Could not save the asset. Try again." };
    throw error;
  }
}

export async function updateAssetFormAction(_previous: AssetFormState, formData: FormData): Promise<AssetFormState> {
  try {
    await updateAssetAction(formData);
    return {};
  } catch (error) {
    if (error instanceof z.ZodError) return validationState(error);
    if (error instanceof Error && error.message === "Could not update the asset") return { error: "Could not save the asset. Try again." };
    if (error instanceof Error && error.message.startsWith("This asset changed or is no longer available")) return { error: error.message, conflict: true };
    throw error;
  }
}

export { updateAssetAction };
