import { type FormEvent, useEffect, useState } from "react";

import { api, type InstallationSettings } from "./api";
import { Button, Field, Loading, Toggle } from "./components";

import { flashSaved, Page } from "./dashboard-shared";

export function InstallationPage() {
  const [settings, setSettings] = useState<InstallationSettings>();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void api.getInstallationSettings().then(setSettings);
  }, []);
  if (settings === undefined) return <Loading />;
  const currentSettings = settings;
  const smtp = currentSettings.smtp ?? {
    fromEmail: "",
    fromName: "Summyz Community",
    host: "smtp-relay.brevo.com",
    port: 587,
    replyTo: null,
    secure: false,
    user: "",
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    const { secrets: _secrets, setupCompleted: _setupCompleted, ...value } = currentSettings;
    await api.updateInstallationSettings(value);
    flashSaved(setSaved);
  }
  return (
    <Page
      title="Instalação"
      eyebrow="Administração"
      description="Credenciais globais, SMTP e disponibilidade do cadastro."
    >
      {saved && <span className="save-toast">Alterações salvas</span>}
      <form className="installation-grid" onSubmit={save}>
        <DiscordSettingsPanel settings={currentSettings} update={setSettings} />
        <ProviderSettingsPanel settings={currentSettings} smtp={smtp} update={setSettings} />
        <AccessSettingsPanel settings={currentSettings} update={setSettings} />
      </form>
    </Page>
  );
}

interface SettingsPanelProps {
  settings: InstallationSettings;
  update(settings: InstallationSettings): void;
}

function DiscordSettingsPanel({ settings, update }: SettingsPanelProps) {
  return (
    <section className="panel stack">
      <h2>Discord</h2>
      <Field
        label="Client ID"
        value={settings.discordClientId ?? ""}
        onChange={(event) =>
          update({ ...settings, discordClientId: event.currentTarget.value || null })
        }
      />
      <SecretField
        configured={settings.secrets.discordBotToken}
        label="Token do bot"
        name="discord_bot_token"
      />
      <SecretField
        configured={settings.secrets.discordClientSecret}
        label="Client secret"
        name="discord_client_secret"
      />
      <Field
        label="URL pública"
        type="url"
        value={settings.publicBaseUrl ?? ""}
        onChange={(event) =>
          update({ ...settings, publicBaseUrl: event.currentTarget.value || null })
        }
      />
    </section>
  );
}

function ProviderSettingsPanel({
  settings,
  smtp,
  update,
}: SettingsPanelProps & { smtp: NonNullable<InstallationSettings["smtp"]> }) {
  const updateSmtp = (next: typeof smtp) => update({ ...settings, smtp: next });
  return (
    <section className="panel stack">
      <h2>Provedores</h2>
      <SecretField
        configured={settings.secrets.openRouterApiKey}
        label="Chave OpenRouter"
        name="openrouter_api_key"
      />
      <h2>E-mail SMTP</h2>
      <p className="muted">
        Compatível com Brevo e outros provedores SMTP. O plano gratuito recomendado é o Brevo.
      </p>
      <Toggle
        checked={settings.smtp !== null}
        label="Envio de e-mail ativo"
        description="Necessário para verificar cadastros e redefinir senhas."
        onChange={(enabled) => update({ ...settings, smtp: enabled ? smtp : null })}
      />
      <div className="form-grid">
        <Field
          label="Servidor SMTP"
          value={smtp.host}
          onChange={(event) => updateSmtp({ ...smtp, host: event.currentTarget.value })}
        />
        <Field
          label="Porta"
          min={1}
          type="number"
          value={smtp.port}
          onChange={(event) => updateSmtp({ ...smtp, port: event.currentTarget.valueAsNumber })}
        />
      </div>
      <Field
        label="Login SMTP"
        value={smtp.user}
        onChange={(event) => updateSmtp({ ...smtp, user: event.currentTarget.value })}
      />
      <div className="form-grid">
        <Field
          label="E-mail remetente"
          type="email"
          value={smtp.fromEmail}
          onChange={(event) => updateSmtp({ ...smtp, fromEmail: event.currentTarget.value })}
        />
        <Field
          label="Nome do remetente"
          value={smtp.fromName}
          onChange={(event) => updateSmtp({ ...smtp, fromName: event.currentTarget.value })}
        />
      </div>
      <Toggle
        checked={smtp.secure}
        label="TLS implícito"
        description="Use com a porta 465. Na porta 587, mantenha desativado para STARTTLS."
        onChange={(secure) => updateSmtp({ ...smtp, secure })}
      />
      <SecretField
        configured={settings.secrets.smtpPassword}
        label="Senha SMTP"
        name="smtp_password"
      />
    </section>
  );
}

function AccessSettingsPanel({ settings, update }: SettingsPanelProps) {
  return (
    <section className="panel stack">
      <h2>Acesso</h2>
      <Toggle
        checked={settings.registrationEnabled}
        label="Cadastro público"
        description="Qualquer pessoa pode criar conta; servidores continuam limitados aos proprietários."
        onChange={(registrationEnabled) => update({ ...settings, registrationEnabled })}
      />
      <Button type="submit">Salvar instalação</Button>
    </section>
  );
}

function SecretField({
  configured,
  label,
  name,
}: {
  configured: boolean;
  label: string;
  name: string;
}) {
  const [value, setValue] = useState("");
  async function save() {
    if (value === "") return;
    await api.updateSecret(name, value);
    setValue("");
  }
  return (
    <div className="secret-field">
      <Field
        label={label}
        onChange={(event) => setValue(event.currentTarget.value)}
        placeholder={configured ? "Configurado — digite para substituir" : "Ainda não configurado"}
        type="password"
        value={value}
      />
      <Button className="secondary" onClick={save} type="button">
        Atualizar
      </Button>
    </div>
  );
}
