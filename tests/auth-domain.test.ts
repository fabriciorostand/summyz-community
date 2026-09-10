import { describe, expect, it } from "vitest";

import {
  type DashboardAccess,
  dashboardLanguageSchema,
  dashboardThemeSchema,
} from "../src/auth/auth-domain.js";

describe("dashboard access domain", () => {
  it("models installation-wide preferences without a user account", () => {
    const access: DashboardAccess = {
      dashboardLanguage: "pt-BR",
      dashboardTheme: "system",
    };

    expect(access).toEqual({ dashboardLanguage: "pt-BR", dashboardTheme: "system" });
    expect(access).not.toHaveProperty("userId");
    expect(access).not.toHaveProperty("email");
    expect(access).not.toHaveProperty("discordUsername");
  });

  it("accepts only supported global dashboard preferences", () => {
    expect(dashboardLanguageSchema.safeParse("pt-BR").success).toBe(true);
    expect(dashboardLanguageSchema.safeParse("en").success).toBe(true);
    expect(dashboardThemeSchema.safeParse("system").success).toBe(true);
    expect(dashboardThemeSchema.safeParse("light").success).toBe(true);
    expect(dashboardThemeSchema.safeParse("dark").success).toBe(true);
    expect(dashboardThemeSchema.safeParse("sepia").success).toBe(false);
  });
});
