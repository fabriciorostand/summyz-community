import { z } from "zod";

export const dashboardLanguageSchema = z.enum(["en", "pt-BR"]);
export const dashboardThemeSchema = z.enum(["system", "light", "dark"]);

export interface DashboardAccess {
  dashboardLanguage: z.infer<typeof dashboardLanguageSchema>;
  dashboardTheme: z.infer<typeof dashboardThemeSchema>;
}
