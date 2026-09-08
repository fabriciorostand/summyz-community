import { Check, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button, Field, FormError, Toggle } from "../components/ui";
import { api } from "../lib/api";

interface SetupDraft {
  discordBotToken: string;
  discordClientId: string;
  discordClientSecret: string;
  email: string;
  password: string;
  publicBaseUrl: string;
  registrationEnabled: boolean;
  setupToken: string;
  smtpFromEmail: string;
  smtpFromName: string;
  smtpHost: string;
  smtpPassword: string;
  smtpPort: number;
  smtpUser: string;
}

const emptyDraft: SetupDraft = {
  discordBotToken: "",
  discordClientId: "",
  discordClientSecret: "",
  email: "",
  password: "",
  publicBaseUrl: "http://127.0.0.1:8787",
  registrationEnabled: true,
  setupToken: "",
  smtpFromEmail: "",
  smtpFromName: "Summyz Community",
  smtpHost: "smtp-relay.brevo.com",
  smtpPassword: "",
  smtpPort: 587,
  smtpUser: "",
};

const steps = ["Conta administradora", "Aplicação Discord", "Envio de e-mail"] as const;

export function SetupPage({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const update = <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function finish() {
    setBusy(true);
    setError(undefined);
    try {
      await api.setup(draft.setupToken, {
        administrator: {
          dashboardLanguage: "pt-BR",
          email: draft.email,
          password: draft.password,
        },
        installation: {
          discordClientId: draft.discordClientId,
          publicBaseUrl: draft.publicBaseUrl,
          registrationEnabled: draft.registrationEnabled,
          secrets: {
            discordBotToken: draft.discordBotToken,
            discordClientSecret: draft.discordClientSecret,
            smtpPassword: draft.smtpPassword,
          },
          smtp: {
            fromEmail: draft.smtpFromEmail,
            fromName: draft.smtpFromName,
            host: draft.smtpHost,
            port: draft.smtpPort,
            replyTo: null,
            secure: false,
            user: draft.smtpUser,
          },
        },
      });
      onComplete();
    } catch {
      setError("O setup não pôde ser concluído. Confira o token e os campos.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas">
      <header className="flex items-center gap-3 border-b border-line-soft bg-surface-rail px-6 py-4">
        <span className="grid size-7 place-items-center rounded-lg bg-action text-[13px] font-bold text-white">
          S
        </span>
        <span className="text-[14.5px] font-semibold tracking-tight text-ink">
          Summyz Community
        </span>
        <span className="label-mono ml-auto text-ink-muted">Primeira execução</span>
      </header>
      <div className="mx-auto grid max-w-5xl gap-10 p-6 py-12 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section>
          <p className="label-mono m-0 mb-3 text-accent">Configuração</p>
          <h1 className="m-0 text-[30px] leading-tight font-semibold tracking-tight text-ink">
            Deixe o Summyz pronto para a sua equipe.
          </h1>
          <p className="m-0 mt-3 max-w-md text-[14px] leading-relaxed text-ink-muted">
            Crie o administrador e conecte a aplicação do Discord. Os segredos são criptografados
            antes de chegarem ao banco.
          </p>
          <ol className="mt-8 mb-0 flex list-none flex-col gap-2 p-0">
            {steps.map((label, index) => (
              <li
                className={`flex items-center gap-3 rounded-lg border px-3.5 py-3 ${
                  index === step ? "border-action bg-action-soft" : "border-line bg-surface-raised"
                }`}
                key={label}
              >
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-md font-mono text-[11px] ${
                    index < step
                      ? "bg-ok text-white"
                      : index === step
                        ? "bg-action text-white"
                        : "bg-surface-inset text-ink-muted"
                  }`}
                >
                  {index < step ? <Check className="size-3" /> : index + 1}
                </span>
                <span
                  className={`text-[13px] ${index === step ? "text-ink" : "text-ink-secondary"}`}
                >
                  {label}
                </span>
                {index === step && <ChevronRight className="ml-auto size-3.5 text-accent" />}
              </li>
            ))}
          </ol>
          <div className="mt-8 rounded-xl border border-line bg-surface p-4">
            <strong className="text-[12.5px] text-ink">Privacidade previsível</strong>
            <p className="m-0 mt-1.5 text-[12px] leading-relaxed text-ink-muted">
              O conteúdo das reuniões fica salvo por padrão. O áudio começa desativado e pode ser
              habilitado servidor por servidor.
            </p>
          </div>
        </section>

        <form
          className="flex h-fit flex-col gap-4 rounded-xl border border-line bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (step < steps.length - 1) setStep(step + 1);
            else void finish();
          }}
        >
          <div className="flex items-center gap-3">
            <span className="label-mono text-ink-muted">
              Passo {step + 1} de {steps.length} · {steps[step]}
            </span>
            <span className="h-px flex-1 bg-line-soft" />
          </div>

          {step === 0 && (
            <>
              <Field
                hint="Impresso no log do primeiro start."
                label="Token de configuração"
                onChange={(event) => update("setupToken", event.currentTarget.value)}
                required
                type="password"
                value={draft.setupToken}
              />
              <Field
                label="E-mail"
                onChange={(event) => update("email", event.currentTarget.value)}
                placeholder="voce@empresa.com"
                required
                type="email"
                value={draft.email}
              />
              <Field
                hint="Mínimo de 12 caracteres."
                label="Senha"
                minLength={12}
                onChange={(event) => update("password", event.currentTarget.value)}
                required
                type="password"
                value={draft.password}
              />
              <Toggle
                checked={draft.registrationEnabled}
                description="Pode ser alterado depois em Instalação."
                label="Permitir novos cadastros"
                onChange={(value) => update("registrationEnabled", value)}
              />
            </>
          )}

          {step === 1 && (
            <>
              <Field
                label="Client ID"
                onChange={(event) => update("discordClientId", event.currentTarget.value)}
                required
                value={draft.discordClientId}
              />
              <Field
                label="Client secret"
                onChange={(event) => update("discordClientSecret", event.currentTarget.value)}
                required
                type="password"
                value={draft.discordClientSecret}
              />
              <Field
                label="Token do bot"
                onChange={(event) => update("discordBotToken", event.currentTarget.value)}
                required
                type="password"
                value={draft.discordBotToken}
              />
              <Field
                label="URL pública"
                onChange={(event) => update("publicBaseUrl", event.currentTarget.value)}
                required
                type="url"
                value={draft.publicBaseUrl}
              />
            </>
          )}

          {step === 2 && (
            <>
              <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                <Field
                  label="Servidor SMTP"
                  onChange={(event) => update("smtpHost", event.currentTarget.value)}
                  required
                  value={draft.smtpHost}
                />
                <Field
                  label="Porta"
                  min={1}
                  onChange={(event) => update("smtpPort", event.currentTarget.valueAsNumber)}
                  required
                  type="number"
                  value={draft.smtpPort}
                />
              </div>
              <Field
                label="Login SMTP"
                onChange={(event) => update("smtpUser", event.currentTarget.value)}
                required
                value={draft.smtpUser}
              />
              <Field
                label="Senha SMTP"
                onChange={(event) => update("smtpPassword", event.currentTarget.value)}
                required
                type="password"
                value={draft.smtpPassword}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="E-mail remetente"
                  onChange={(event) => update("smtpFromEmail", event.currentTarget.value)}
                  required
                  type="email"
                  value={draft.smtpFromEmail}
                />
                <Field
                  label="Nome do remetente"
                  onChange={(event) => update("smtpFromName", event.currentTarget.value)}
                  required
                  value={draft.smtpFromName}
                />
              </div>
            </>
          )}

          {error !== undefined && <FormError>{error}</FormError>}

          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button onClick={() => setStep(step - 1)} type="button" variant="secondary">
                Voltar
              </Button>
            )}
            <Button disabled={busy} type="submit">
              {step < steps.length - 1
                ? "Continuar"
                : busy
                  ? "Configurando…"
                  : "Concluir configuração"}
            </Button>
          </div>
          {step < steps.length - 1 && (
            <span className="text-[11.5px] text-ink-dim">
              Você poderá revisar tudo antes de concluir.
            </span>
          )}
        </form>
      </div>
    </main>
  );
}
