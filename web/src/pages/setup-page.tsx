import { ArrowUpRight, Check, TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { InstallBotLink } from "../components/states";
import { HelpTip } from "../components/ui";
import { Brand } from "../layout/sidebar";
import { type AccessMode, ApiError, api } from "../lib/api";

type Step = "token" | "password" | "done";
type SetupFailure = "invalid_discord_bot_token" | "invalid_setup_token" | "request_failed";

const minimumPasswordLength = 15;

function failureOf(caught: unknown): SetupFailure {
  const code = caught instanceof ApiError ? caught.code : "request_failed";
  return code === "invalid_discord_bot_token" || code === "invalid_setup_token"
    ? code
    : "request_failed";
}

/** Reads `#claim=<token>` once; the launcher puts it there and it must never stay in the URL. */
function readClaim(hash: string): string | undefined {
  const claim = new URLSearchParams(hash.replace(/^#/u, "")).get("claim");
  return claim === null || claim.length === 0 ? undefined : claim;
}

export function SetupPage({
  accessMode,
  onComplete,
}: {
  accessMode: AccessMode;
  onComplete: () => void;
}) {
  const location = useLocation();
  const [claim] = useState(() => readClaim(location.hash));
  const [step, setStep] = useState<Step>("token");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SetupFailure>();
  const [installUrl, setInstallUrl] = useState<string>();

  useEffect(() => {
    if (location.hash.length === 0) return;
    window.history.replaceState(null, "", `${location.pathname}${location.search}`);
  }, [location.hash, location.pathname, location.search]);

  useEffect(() => {
    if (step !== "done") return;
    void api.getBotInstallation().then(
      (bot) => setInstallUrl(bot.configured ? bot.installUrl : undefined),
      () => setInstallUrl(undefined),
    );
  }, [step]);

  const isPublic = accessMode === "public";
  const passwordReady = [...password].length >= minimumPasswordLength;

  async function finish() {
    setBusy(true);
    setFailure(undefined);
    try {
      await api.setup(
        isPublic ? claim : undefined,
        isPublic
          ? { discordBotToken: token, installationPassword: password }
          : { discordBotToken: token },
      );
      setStep("done");
    } catch (caught) {
      const next = failureOf(caught);
      setFailure(next);
      if (next === "invalid_discord_bot_token") setStep("token");
    } finally {
      setBusy(false);
    }
  }

  function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token.trim().length === 0) return;
    setFailure(undefined);
    if (isPublic) setStep("password");
    else void finish();
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordReady) return;
    void finish();
  }

  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="flex flex-col border-r border-line-soft bg-surface-rail p-6">
        <div className="mb-7">
          <Brand label="Summyz Community" />
        </div>
        <ol className="m-0 grid list-none gap-1 p-0">
          <RailStep
            alert={failure === "invalid_discord_bot_token"}
            label="Token do bot"
            number={1}
            state={step === "token" ? "active" : "done"}
          />
          {isPublic && (
            <RailStep
              label="Senha da instalação"
              number={2}
              state={step === "password" ? "active" : step === "done" ? "done" : "idle"}
            />
          )}
          <RailStep
            label="Adicionar a um servidor"
            number={isPublic ? 3 : 2}
            state={step === "done" ? "active" : "idle"}
          />
        </ol>
        <dl className="mt-auto m-0 grid gap-2.5 font-mono text-[11px] text-ink-dim">
          <div className="flex justify-between">
            <dt className="uppercase">Modo</dt>
            <dd className="m-0 flex items-center gap-1.5 text-ink-secondary">
              {isPublic ? "Público" : "Local"}
              {!isPublic && (
                <HelpTip placement="left">
                  No modo local o dashboard escuta só em 127.0.0.1 e não pede senha — por isso não
                  existe o passo da senha aqui.
                </HelpTip>
              )}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="uppercase">Bot</dt>
            <dd className={`m-0 ${step === "done" ? "text-ok" : "text-fail"}`}>
              {step === "done" ? "Online" : "Não conectado"}
            </dd>
          </div>
        </dl>
      </aside>

      <section className="grid place-items-center p-7">
        {step === "token" && (
          <TokenStep
            busy={busy}
            failure={failure}
            isPublic={isPublic}
            onChange={(value) => {
              setToken(value);
              setFailure(undefined);
            }}
            onSubmit={submitToken}
            token={token}
          />
        )}
        {step === "password" && (
          <PasswordStep
            busy={busy}
            failure={failure}
            onBack={() => setStep("token")}
            onChange={setPassword}
            onSubmit={submitPassword}
            password={password}
            ready={passwordReady}
          />
        )}
        {step === "done" && <DoneStep installUrl={installUrl} onComplete={onComplete} />}
      </section>
    </main>
  );
}

function TokenStep({
  busy,
  failure,
  isPublic,
  onChange,
  onSubmit,
  token,
}: {
  busy: boolean;
  failure: SetupFailure | undefined;
  isPublic: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  token: string;
}) {
  return (
    <form className="w-full max-w-[380px]" onSubmit={onSubmit}>
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[23px] font-semibold tracking-tight text-ink">
          Cole o token do bot
        </h2>
        <HelpTip placement="left">
          Developer Portal → sua aplicação → Bot → Reset Token. O Application ID é derivado dele.
        </HelpTip>
      </div>
      <input
        aria-label="Token do bot"
        autoComplete="off"
        className={`mt-6 w-full rounded-[11px] border bg-surface px-4.5 py-4 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-dim focus:border-action ${
          failure === "invalid_discord_bot_token" ? "border-fail/60" : "border-line-strong"
        }`}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="••••••••••••••••••••••••"
        type="password"
        value={token}
      />
      {failure !== undefined && <FailureLine failure={failure} />}
      <div className="mt-6 flex justify-center">
        <PrimaryButton busy={busy} busyLabel="Validando no Discord…">
          {isPublic ? "Continuar" : "Concluir"}
        </PrimaryButton>
      </div>
    </form>
  );
}

function PasswordStep({
  busy,
  failure,
  onBack,
  onChange,
  onSubmit,
  password,
  ready,
}: {
  busy: boolean;
  failure: SetupFailure | undefined;
  onBack: () => void;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  password: string;
  ready: boolean;
}) {
  const border =
    password.length === 0 ? "border-line-strong" : ready ? "border-action/60" : "border-warn/50";
  return (
    <form className="w-full max-w-[400px]" onSubmit={onSubmit}>
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[23px] font-semibold tracking-tight text-ink">
          Escolha a senha desta instalação
        </h2>
        <HelpTip placement="left">
          Uma senha por instalação — não existe conta de usuário. De 15 a 128 caracteres; uma frase
          longa vale mais que símbolos embaralhados.
        </HelpTip>
      </div>
      <input
        aria-label="Senha da instalação"
        autoComplete="new-password"
        className={`mt-6 w-full rounded-[11px] border bg-surface px-4.5 py-4 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-dim focus:border-action ${border}`}
        maxLength={128}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="uma frase que você lembre"
        type="password"
        value={password}
      />
      <PasswordMeter password={password} />
      {failure !== undefined && <FailureLine failure={failure} />}
      <div className="mt-6 flex items-center gap-2.5">
        <PrimaryButton busy={busy} busyLabel="Concluindo…" disabled={!ready}>
          Concluir
        </PrimaryButton>
        <button
          className="rounded-[10px] border border-line px-4.5 py-3 text-[14px] text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
          onClick={onBack}
          type="button"
        >
          Voltar
        </button>
      </div>
    </form>
  );
}

function DoneStep({
  installUrl,
  onComplete,
}: {
  installUrl: string | undefined;
  onComplete: () => void;
}) {
  return (
    <div className="w-full max-w-[400px]">
      <span className="mb-5 grid size-11 place-items-center rounded-xl border border-ok/40 bg-ok-soft text-ok">
        <Check className="size-5" />
      </span>
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[23px] font-semibold tracking-tight text-ink">Bot conectado</h2>
        <HelpTip placement="left">
          Falta ativar um perfil de IA no servidor — é o que libera o{" "}
          <code className="font-mono text-accent-hover">/record</code>.
        </HelpTip>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <InstallBotLink installUrl={installUrl}>
          Adicionar a um servidor
          <ArrowUpRight className="size-3.5" />
        </InstallBotLink>
        <button
          className="rounded-[10px] border border-line px-4.5 py-2 text-[13.5px] text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
          onClick={onComplete}
          type="button"
        >
          Ir para o dashboard
        </button>
      </div>
    </div>
  );
}

function RailStep({
  alert = false,
  label,
  number,
  state,
}: {
  alert?: boolean;
  label: string;
  number: number;
  state: "done" | "active" | "idle";
}) {
  return (
    <li
      className={`flex items-center gap-3 rounded-[9px] border px-3 py-2.5 ${
        state === "active" ? "border-action/50 bg-action-soft" : "border-transparent"
      }`}
    >
      <span
        className={`grid size-5 place-items-center rounded-md font-mono text-[10px] font-bold ${
          state === "done"
            ? "bg-ok-soft text-ok"
            : state === "active"
              ? "bg-action text-white"
              : "bg-surface-inset text-ink-muted"
        }`}
      >
        {state === "done" ? <Check className="size-3" /> : number}
      </span>
      <span className={`text-[13px] ${state === "active" ? "text-ink" : "text-ink-secondary"}`}>
        {label}
      </span>
      {alert && <TriangleAlert className="ml-auto size-3.5 text-fail" />}
    </li>
  );
}

function PrimaryButton({
  busy,
  busyLabel,
  children,
  disabled = false,
}: {
  busy: boolean;
  busyLabel: string;
  children: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="flex items-center justify-center gap-2 rounded-[10px] bg-action px-6 py-3 text-[14px] font-medium text-white transition-colors hover:bg-action-hover disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-ink-dim"
      disabled={busy || disabled}
      type="submit"
    >
      {busy ? (
        <>
          <span className="live-dot size-1.5 rounded-full bg-white" />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

function FailureLine({ failure }: { failure: SetupFailure }) {
  const messages: Record<SetupFailure, string> = {
    invalid_discord_bot_token: "Token recusado pelo Discord",
    invalid_setup_token:
      "O link privado de setup não confere. Abra de novo a URL impressa pelo launcher.",
    request_failed: "O setup não pôde ser concluído. Tente de novo em instantes.",
  };
  return (
    <div className="mt-2.5 flex items-start gap-2" role="alert">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-fail" />
      <span className="text-[12.5px] text-fail">{messages[failure]}</span>
    </div>
  );
}

/** Four segments: length is the only rule, so the meter reads "curta" until 15 characters. */
function PasswordMeter({ password }: { password: string }) {
  const length = [...password].length;
  const level = length === 0 ? 0 : length < 8 ? 1 : length < 15 ? 2 : length < 20 ? 3 : 4;
  const ready = length >= minimumPasswordLength;
  const fill = ready ? "bg-ok" : "bg-warn";
  const label =
    length === 0
      ? "Mínimo 15"
      : ready
        ? `Boa · ${String(length)} caracteres`
        : `Curta · ${String(length)} de 15`;
  return (
    <div className="mt-2.5 flex items-center gap-2.5">
      <span className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((segment) => (
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-inset" key={segment}>
            {level >= segment && <span className={`block h-full rounded-full ${fill}`} />}
          </span>
        ))}
      </span>
      <span className={`label-mono ${ready ? "text-ok" : "text-ink-dim"}`}>{label}</span>
    </div>
  );
}
