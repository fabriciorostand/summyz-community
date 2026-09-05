import { describe, expect, it, vi } from "vitest";

import { SmtpAuthenticationEmailSender } from "../src/auth/smtp-email-sender.js";

describe("SmtpAuthenticationEmailSender", () => {
  it("sends verification and reset links without logging or returning credentials", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "message-1" }));
    const createTransport = vi.fn(() => ({ sendMail }));
    const settings = {
      getSecret: vi.fn(async () => "smtp-password"),
      getSettings: vi.fn(async () => ({
        discordClientId: null,
        publicBaseUrl: "https://summyz.example.com",
        registrationEnabled: true,
        secrets: {
          discordBotToken: false,
          discordClientSecret: false,
          openRouterApiKey: false,
          smtpPassword: true,
        },
        setupCompleted: true,
        smtp: {
          fromEmail: "hello@example.com",
          fromName: "Summyz Community",
          host: "smtp-relay.brevo.com",
          port: 587,
          replyTo: null,
          secure: false,
          user: "smtp-user",
        },
      })),
    };
    const sender = new SmtpAuthenticationEmailSender({ createTransport, settings });

    await sender.sendVerification({ email: "person@example.com", token: "verify-token" });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { pass: "smtp-password", user: "smtp-user" } }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("https://summyz.example.com/verify-email?token=verify-token"),
        to: "person@example.com",
      }),
    );
  });
});
