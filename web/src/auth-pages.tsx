import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { api, ApiError, type SetupStatus } from "./api";
import { Brand, Button, Field } from "./components";

function AuthFrame({
  children,
  eyebrow,
  title,
}: {
  children: React.ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <Brand />
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>Conversas viram decisões. Decisões viram movimento.</h1>
          <p>
            Configure gravação, transcrição e resumos do seu servidor sem perder o controle dos
            dados.
          </p>
        </div>
        <p className="quiet">Feito para equipes que preferem clareza a mais uma reunião.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">Acesso seguro</p>
          <h2>{title}</h2>
          {children}
        </div>
      </section>
    </main>
  );
}

export function LoginPage({ registrationEnabled }: { registrationEnabled: boolean }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await api.login(String(form.get("email")), String(form.get("password")));
      navigate("/");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? "E-mail ou senha incorretos." : "Não foi possível entrar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame eyebrow="Bem-vindo de volta" title="Entre no Summyz Community">
      <form className="stack" onSubmit={submit}>
        <Field autoComplete="email" label="E-mail" name="email" required type="email" />
        <Field
          autoComplete="current-password"
          label="Senha"
          name="password"
          required
          type="password"
        />
        {error !== undefined && <p className="form-error">{error}</p>}
        <Button disabled={busy} type="submit">
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>
      <div className="auth-links">
        <Link to="/forgot-password">Esqueci minha senha</Link>
        {registrationEnabled && <Link to="/register">Criar uma conta</Link>}
      </div>
    </AuthFrame>
  );
}

export function RegisterPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api.register(String(form.get("email")), String(form.get("password")), "pt-BR");
      setSent(true);
    } catch {
      setError("Não foi possível criar a conta. Confira os dados e tente novamente.");
    }
  }
  return (
    <AuthFrame eyebrow="Novo por aqui" title="Crie sua conta">
      {sent ? (
        <div className="notice success">
          <strong>Verifique seu e-mail</strong>
          <p>Enviamos um link para ativar sua conta.</p>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field autoComplete="email" label="E-mail" name="email" required type="email" />
          <Field
            hint="Use pelo menos 12 caracteres."
            label="Senha"
            minLength={12}
            name="password"
            required
            type="password"
          />
          {error !== undefined && <p className="form-error">{error}</p>}
          <Button type="submit">Criar conta</Button>
        </form>
      )}
      <div className="auth-links">
        <Link to="/login">Já tenho uma conta</Link>
      </div>
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await api.forgotPassword(String(new FormData(event.currentTarget).get("email")));
    setSent(true);
  }
  return (
    <AuthFrame eyebrow="Recuperação" title="Redefina sua senha">
      {sent ? (
        <p className="notice success">Se a conta existir, você receberá um link em instantes.</p>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field label="E-mail" name="email" required type="email" />
          <Button type="submit">Enviar link</Button>
        </form>
      )}
      <div className="auth-links">
        <Link to="/login">Voltar ao login</Link>
      </div>
    </AuthFrame>
  );
}

export function ResetPasswordPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await api.resetPassword(
      search.get("token") ?? "",
      String(new FormData(event.currentTarget).get("password")),
    );
    navigate("/login");
  }
  return (
    <AuthFrame eyebrow="Nova senha" title="Proteja sua conta">
      <form className="stack" onSubmit={submit}>
        <Field label="Nova senha" minLength={12} name="password" required type="password" />
        <Button type="submit">Salvar nova senha</Button>
      </form>
    </AuthFrame>
  );
}

export function VerifyPage() {
  const [search] = useSearchParams();
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  async function verify() {
    try {
      await api.verifyEmail(search.get("token") ?? "");
      setState("done");
    } catch {
      setState("error");
    }
  }
  return (
    <AuthFrame eyebrow="Confirmação" title="Verifique seu e-mail">
      <p>
        {state === "done"
          ? "Conta verificada. Você já pode entrar."
          : state === "error"
            ? "Este link é inválido ou expirou."
            : "Confirme que este endereço pertence a você."}
      </p>
      {state === "idle" && <Button onClick={verify}>Verificar e-mail</Button>}
      <div className="auth-links">
        <Link to="/login">Ir para o login</Link>
      </div>
    </AuthFrame>
  );
}

export function SetupPage({
  onComplete,
  status: _status,
}: {
  onComplete: () => void;
  status: SetupStatus;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      await api.setup(String(form.get("setupToken")), {
        administrator: {
          dashboardLanguage: "pt-BR",
          email: String(form.get("email")),
          password: String(form.get("password")),
        },
        installation: {
          discordClientId: String(form.get("discordClientId")),
          publicBaseUrl: String(form.get("publicBaseUrl")),
          registrationEnabled: form.get("registrationEnabled") === "on",
          smtp: {
            fromEmail: String(form.get("smtpFromEmail")),
            fromName: String(form.get("smtpFromName")),
            host: String(form.get("smtpHost")),
            port: Number(form.get("smtpPort")),
            replyTo: null,
            secure: false,
            user: String(form.get("smtpUser")),
          },
          secrets: {
            discordBotToken: String(form.get("discordBotToken")),
            discordClientSecret: String(form.get("discordClientSecret")),
            smtpPassword: String(form.get("smtpPassword")),
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
    <main className="setup-shell">
      <header>
        <Brand />
        <span className="step-pill">Configuração inicial</span>
      </header>
      <div className="setup-grid">
        <section>
          <p className="eyebrow">Primeira execução</p>
          <h1>Deixe o Summyz Community pronto para a sua equipe.</h1>
          <p className="lede">
            Crie o administrador e conecte a aplicação do Discord. Os segredos serão criptografados
            antes de chegarem ao banco.
          </p>
          <div className="retention-note">
            <strong>Privacidade previsível</strong>
            <p>
              O conteúdo das reuniões fica salvo por padrão. O áudio começa desativado e pode ser
              habilitado individualmente em cada servidor.
            </p>
          </div>
        </section>
        <form className="setup-form stack" onSubmit={submit}>
          <h2>Conta administradora</h2>
          <Field label="Token de configuração" name="setupToken" required type="password" />
          <Field label="E-mail" name="email" required type="email" />
          <Field
            hint="Mínimo de 12 caracteres."
            label="Senha"
            minLength={12}
            name="password"
            required
            type="password"
          />
          <hr />
          <h2>Aplicação Discord</h2>
          <Field label="Client ID" name="discordClientId" required />
          <Field label="Client secret" name="discordClientSecret" required type="password" />
          <Field label="Token do bot" name="discordBotToken" required type="password" />
          <Field
            defaultValue="http://127.0.0.1:8787"
            label="URL pública"
            name="publicBaseUrl"
            required
            type="url"
          />
          <hr />
          <h2>E-mail com Brevo</h2>
          <Field
            defaultValue="smtp-relay.brevo.com"
            label="Servidor SMTP"
            name="smtpHost"
            required
          />
          <Field defaultValue="587" label="Porta" name="smtpPort" required type="number" />
          <Field label="Login SMTP" name="smtpUser" required />
          <Field label="Senha SMTP" name="smtpPassword" required type="password" />
          <Field label="E-mail remetente" name="smtpFromEmail" required type="email" />
          <Field
            defaultValue="Summyz Community"
            label="Nome do remetente"
            name="smtpFromName"
            required
          />
          <label className="check">
            <input defaultChecked name="registrationEnabled" type="checkbox" /> Permitir novos
            cadastros
          </label>
          {error !== undefined && <p className="form-error">{error}</p>}
          <Button disabled={busy} type="submit">
            {busy ? "Configurando…" : "Concluir configuração"}
          </Button>
        </form>
      </div>
    </main>
  );
}
