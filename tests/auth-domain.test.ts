import { describe, expect, it } from "vitest";

import {
  type AuthenticatedUser,
  dashboardThemeSchema,
  emailAddressSchema,
  normalizeEmailAddress,
  passwordSchema,
} from "../src/auth/auth-domain.js";

describe("authentication domain", () => {
  it("normalizes and validates email addresses", () => {
    expect(normalizeEmailAddress("  Person@Example.COM ")).toBe("person@example.com");
    expect(emailAddressSchema.safeParse("not-an-email").success).toBe(false);
  });

  it("accepts long passphrases and rejects weak or excessive input", () => {
    expect(passwordSchema.safeParse("correct horse battery staple").success).toBe(true);
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("x".repeat(1_025)).success).toBe(false);
  });

  it("models installation administrators separately from Discord ownership", () => {
    const user: AuthenticatedUser = {
      dashboardLanguage: "pt-BR",
      dashboardTheme: "system",
      email: "person@example.com",
      emailVerified: true,
      installationRole: "member",
      userId: "user-1",
    };

    expect(user.installationRole).toBe("member");
    expect(user).not.toHaveProperty("discordGuildIds");
  });

  it("accepts only synchronized dashboard themes", () => {
    expect(dashboardThemeSchema.safeParse("system").success).toBe(true);
    expect(dashboardThemeSchema.safeParse("light").success).toBe(true);
    expect(dashboardThemeSchema.safeParse("dark").success).toBe(true);
    expect(dashboardThemeSchema.safeParse("sepia").success).toBe(false);
  });
});
