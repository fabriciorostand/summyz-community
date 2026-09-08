import { z } from "zod";

export const emailAddressSchema = z.string().trim().toLowerCase().email().max(320);
export const passwordSchema = z.string().min(12).max(1_024);
export const dashboardLanguageSchema = z.enum(["en", "pt-BR"]);
export const dashboardThemeSchema = z.enum(["system", "light", "dark"]);
export const installationRoleSchema = z.enum(["administrator", "member"]);

export interface AuthenticatedUser {
  dashboardLanguage: z.infer<typeof dashboardLanguageSchema>;
  dashboardTheme: z.infer<typeof dashboardThemeSchema>;
  email: string;
  emailVerified: boolean;
  installationRole: z.infer<typeof installationRoleSchema>;
  userId: string;
}

export function normalizeEmailAddress(input: string): string {
  return emailAddressSchema.parse(input);
}
