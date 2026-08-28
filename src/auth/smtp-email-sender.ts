import nodemailer from "nodemailer";

import type { AuthenticationEmailSender } from "./auth-service.js";
import type {
  InstallationSettings,
  InstallationSecretName,
} from "../database/postgres-installation-settings-store.js";

interface SettingsReader {
  getSecret(name: InstallationSecretName): Promise<string | undefined>;
  getSettings(): Promise<InstallationSettings>;
}

interface MailTransport {
  sendMail(message: {
    from: { address: string; name: string };
    html: string;
    replyTo?: string;
    subject: string;
    text: string;
    to: string;
  }): Promise<unknown>;
}

interface TransportOptions {
  auth: { pass: string; user: string };
  host: string;
  port: number;
  secure: boolean;
}

interface SenderOptions {
  createTransport?: (options: TransportOptions) => MailTransport;
  settings: SettingsReader;
}

export class EmailDeliveryConfigurationError extends Error {
  public constructor() {
    super("SMTP is not completely configured");
    this.name = "EmailDeliveryConfigurationError";
  }
}

export class SmtpAuthenticationEmailSender implements AuthenticationEmailSender {
  readonly #createTransport: (options: TransportOptions) => MailTransport;
  readonly #settings: SettingsReader;

  public constructor(options: SenderOptions) {
    this.#settings = options.settings;
    this.#createTransport =
      options.createTransport ??
      ((transportOptions) => nodemailer.createTransport(transportOptions));
  }

  public async sendVerification(input: { email: string; token: string }): Promise<void> {
    await this.#send({
      actionPath: "/verify-email",
      body: "Confirme seu endereço de e-mail para concluir o cadastro no Summyz.",
      email: input.email,
      linkLabel: "Confirmar e-mail",
      subject: "Confirme seu e-mail no Summyz",
      token: input.token,
    });
  }

  public async sendPasswordReset(input: { email: string; token: string }): Promise<void> {
    await this.#send({
      actionPath: "/reset-password",
      body: "Use o link abaixo para definir uma nova senha. Se você não fez essa solicitação, ignore este e-mail.",
      email: input.email,
      linkLabel: "Redefinir senha",
      subject: "Redefinição de senha do Summyz",
      token: input.token,
    });
  }

  async #send(input: {
    actionPath: string;
    body: string;
    email: string;
    linkLabel: string;
    subject: string;
    token: string;
  }): Promise<void> {
    const settings = await this.#settings.getSettings();
    const password = await this.#settings.getSecret("smtp_password");
    if (settings.smtp === null || settings.publicBaseUrl === null || password === undefined) {
      throw new EmailDeliveryConfigurationError();
    }
    const link = new URL(input.actionPath, ensureTrailingSlash(settings.publicBaseUrl));
    link.searchParams.set("token", input.token);
    const transport = this.#createTransport({
      auth: { pass: password, user: settings.smtp.user },
      host: settings.smtp.host,
      port: settings.smtp.port,
      secure: settings.smtp.secure,
    });
    await transport.sendMail({
      from: { address: settings.smtp.fromEmail, name: settings.smtp.fromName },
      html: `<p>${escapeHtml(input.body)}</p><p><a href="${escapeHtml(link.href)}">${escapeHtml(input.linkLabel)}</a></p>`,
      ...(settings.smtp.replyTo === null ? {} : { replyTo: settings.smtp.replyTo }),
      subject: input.subject,
      text: `${input.body}\n\n${input.linkLabel}: ${link.href}`,
      to: input.email,
    });
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
