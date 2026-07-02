import { z } from "zod";

const email = z.string().trim().toLowerCase().email().max(320);
const password = z.string().min(10).max(128);

export const signInSchema = z.object({ email, password });
export const signUpSchema = z.object({
  displayName: z.string().trim().min(1).max(120), email, password,
  confirmPassword: z.string(),
}).refine((value) => value.password === value.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });
