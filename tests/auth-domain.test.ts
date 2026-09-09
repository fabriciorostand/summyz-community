import { describe, expect, it } from "vitest";

import {
  type AuthenticatedUser,
  dashboardLanguageSchema,
  dashboardThemeSchema,
} from "../src/auth/auth-domain.js";

describe("authentication domain", () => {
  it("models the single Discord installation owner without email or roles", () => {
    const user: AuthenticatedUser = {
      dashboardLanguage: "pt-BR",
      dashboardTheme: "system",
      discordAvatar: null,
      discordUsername: "Fabricio",
      userId: "123456789012345678",
    };

    expect(user.userId).toBe("123456789012345678");
    expect(user).not.toHaveProperty("email");
    expect(user).not.toHaveProperty("installationRole");
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
