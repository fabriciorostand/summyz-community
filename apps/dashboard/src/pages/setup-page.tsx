import { ArrowUpRight, Check, Info, TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { DiscordConnectButton } from "../components/discord-connect-button";
import { InstallBotLink } from "../components/states";
import { HelpTip, Notice } from "../components/ui";
import { useI18n } from "../i18n/store";
import { Brand } from "../layout/sidebar";
import { LanguagePicker } from "../layout/top-bar";
import { type AccessMode, ApiError, api } from "../lib/api";
import { DiscordStep } from "./setup/discord-step";
import {
  FailureLine,
  PrimaryButton,
  SecondaryButton,
  type SetupFailure,
} from "./setup/setup-controls";

type Step = "token" | "discord" | "password" | "done";

/** Public mode adds the installation password; the owner connection is optional in both. */
function stepsFor(isPublic: boolean): Step[] {
  return isPublic ? ["token", "discord", "password", "done"] : ["token", "discord", "done"];
}

function railState(steps: Step[], current: Step, target: Step): "done" | "active" | "idle" {
  const distance = steps.indexOf(current) - steps.indexOf(target);
  if (distance === 0) return "active";
  return distance > 0 ? "done" : "idle";
}

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
  const { language, t } = useI18n();
  const [claim] = useState(() => readClaim(location.hash));
  const [step, setStep] = useState<Step>("token");
  const [token, setToken] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SetupFailure>();
  const [installUrl, setInstallUrl] = useState<string>();
  const [redirectUri, setRedirectUri] = useState<string>();

  useEffect(() => {
    if (location.hash.length === 0) return;
    window.history.replaceState(null, "", `${location.pathname}${location.search}`);
  }, [location.hash, location.pathname, location.search]);

  useEffect(() => {
    let active = true;
    // The redirect URL is only a convenience here; Installation shows it again later.
    void api.getSetupStatus().then(
      (status) => {
        if (active) setRedirectUri(status.discordRedirectUri);
      },
      () => {
        if (active) setRedirectUri(undefined);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (step !== "done") return;
    void api.getBotInstallation().then(
      (bot) => setInstallUrl(bot.configured ? bot.installUrl : undefined),
      () => setInstallUrl(undefined),
    );
  }, [step]);

  const isPublic = accessMode === "public";
  const steps = stepsFor(isPublic);
  const passwordReady = [...password].length >= minimumPasswordLength;

  /** Takes the secret explicitly: skipping clears it in the same click that finishes. */
  async function finish(secret: string) {
    setBusy(true);
    setFailure(undefined);
    const discordClientSecret = secret.trim();
    try {
      // The language on screen names the first AI profile the server creates.
      await api.setup(isPublic ? claim : undefined, {
        discordBotToken: token,
        ...(discordClientSecret === "" ? {} : { discordClientSecret }),
        ...(isPublic ? { installationPassword: password } : {}),
        setupLanguage: language,
      });
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
    setStep("discord");
  }

  function leaveDiscordStep(secret: string) {
    setClientSecret(secret);
    if (isPublic) setStep("password");
    else void finish(secret);
  }

  function submitDiscord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (clientSecret.trim().length === 0) return;
    leaveDiscordStep(clientSecret);
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordReady) return;
    void finish(clientSecret);
  }

  return (
    <main className="grid min-h-screen grid-cols-1 bg-canvas lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* The current step comes first so phones, keyboards and screen readers reach the task
          before the progress rail; from lg the grid puts the rail back on the left. */}
      <section className="flex flex-col gap-4 p-7 lg:col-start-2 lg:row-start-1">
        <div className="flex justify-end">
          <LanguagePicker />
        </div>
        <div className="grid flex-1 place-items-center">
          {step === "token" && (
            <TokenStep
              busy={busy}
              failure={failure}
              onChange={(value) => {
                setToken(value);
                setFailure(undefined);
              }}
              onSubmit={submitToken}
              token={token}
            />
          )}
          {step === "discord" && (
            <DiscordStep
              busy={busy}
              clientSecret={clientSecret}
              failure={failure}
              isLastStep={!isPublic}
              onBack={() => setStep("token")}
              onChange={setClientSecret}
              onSkip={() => leaveDiscordStep("")}
              onSubmit={submitDiscord}
              redirectUri={redirectUri}
            />
          )}
          {step === "password" && (
            <PasswordStep
              busy={busy}
              failure={failure}
              onBack={() => setStep("discord")}
              onChange={setPassword}
              onSubmit={submitPassword}
              password={password}
              ready={passwordReady}
            />
          )}
          {step === "done" && (
            <DoneStep
              canConnect={clientSecret.trim().length > 0}
              installUrl={installUrl}
              isPublic={isPublic}
              onComplete={onComplete}
            />
          )}
        </div>
      </section>

      <aside className="flex flex-col border-t border-line-soft bg-surface-rail p-6 lg:col-start-1 lg:row-start-1 lg:border-t-0 lg:border-r">
        <div className="mb-7">
          <Brand label="Summyz Community" />
        </div>
        <ol className="m-0 grid list-none gap-1 p-0">
          <RailStep
            alert={failure === "invalid_discord_bot_token"}
            label={t.setup.tokenLabel}
            number={1}
            state={railState(steps, step, "token")}
          />
          <RailStep
            label={t.setup.discordLabel}
            number={2}
            state={railState(steps, step, "discord")}
          />
          {isPublic && (
            <RailStep
              label={t.setup.passwordLabel}
              number={3}
              state={railState(steps, step, "password")}
            />
          )}
          <RailStep
            label={t.setup.addToServer}
            number={steps.length}
            state={railState(steps, step, "done")}
          />
        </ol>
        <dl className="mt-auto m-0 grid gap-2.5 font-mono text-[11px] text-ink-dim">
          <div className="flex justify-between">
            <dt className="uppercase">{t.setup.mode}</dt>
            <dd className="m-0 flex items-center gap-1.5 text-ink-secondary">
              {isPublic ? t.setup.public : t.setup.local}
              {!isPublic && <HelpTip placement="left">{t.setup.localModeHelp}</HelpTip>}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="uppercase">{t.setup.bot}</dt>
            <dd className={`m-0 ${step === "done" ? "text-ok" : "text-fail"}`}>
              {step === "done" ? t.setup.online : t.setup.notConnected}
            </dd>
          </div>
        </dl>
      </aside>
    </main>
  );
}

function TokenStep({
  busy,
  failure,
  onChange,
  onSubmit,
  token,
}: {
  busy: boolean;
  failure: SetupFailure | undefined;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  token: string;
}) {
  const { t } = useI18n();
  return (
    <form className="w-full max-w-[380px]" onSubmit={onSubmit}>
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[23px] font-semibold tracking-tight text-ink">
          {t.setup.tokenTitle}
        </h2>
        <HelpTip placement="left">{t.setup.tokenHelp}</HelpTip>
      </div>
      <input
        aria-label={t.setup.tokenLabel}
        autoComplete="off"
        className={`mt-6 w-full rounded-[11px] border bg-surface px-4.5 py-4 text-base text-ink pointer-fine:text-[15px] outline-none transition-colors placeholder:text-ink-dim focus:border-action ${
          failure === "invalid_discord_bot_token" ? "border-fail/60" : "border-line-strong"
        }`}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="••••••••••••••••••••••••"
        type="password"
        value={token}
      />
      {failure !== undefined && <FailureLine failure={failure} />}
      <div className="mt-6 flex justify-center">
        <PrimaryButton busy={busy} busyLabel={t.setup.validating}>
          {t.setup.continue}
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
  const { t } = useI18n();
  const border =
    password.length === 0 ? "border-line-strong" : ready ? "border-action/60" : "border-warn/50";
  return (
    <form className="w-full max-w-[400px]" onSubmit={onSubmit}>
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[23px] font-semibold tracking-tight text-ink">
          {t.setup.passwordTitle}
        </h2>
        <HelpTip placement="left">{t.setup.passwordHelp}</HelpTip>
      </div>
      <input
        aria-label={t.setup.passwordLabel}
        autoComplete="new-password"
        className={`mt-6 w-full rounded-[11px] border bg-surface px-4.5 py-4 text-base text-ink pointer-fine:text-[15px] outline-none transition-colors placeholder:text-ink-dim focus:border-action ${border}`}
        maxLength={128}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={t.setup.passwordPlaceholder}
        type="password"
        value={password}
      />
      <PasswordMeter password={password} />
      {failure !== undefined && <FailureLine failure={failure} />}
      <div className="mt-6 flex items-center gap-2.5">
        <PrimaryButton busy={busy} busyLabel={t.setup.finishing} disabled={!ready}>
          {t.setup.finish}
        </PrimaryButton>
        <SecondaryButton onClick={onBack}>{t.setup.back}</SecondaryButton>
      </div>
    </form>
  );
}

function DoneStep({
  canConnect,
  installUrl,
  isPublic,
  onComplete,
}: {
  /** Only a stored Client Secret lets the owner's account be connected. */
  canConnect: boolean;
  installUrl: string | undefined;
  isPublic: boolean;
  onComplete: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="w-full max-w-[440px]">
      <span className="mb-5 grid size-11 place-items-center rounded-xl border border-ok/40 bg-ok-soft text-ok">
        <Check className="size-5" />
      </span>
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[23px] font-semibold tracking-tight text-ink">
          {t.setup.doneTitle}
        </h2>
        <HelpTip placement="left">
          {t.setup.doneHelpBefore} <code className="font-mono text-accent-hover">/record</code>
          {t.setup.doneHelpAfter}
        </HelpTip>
      </div>
      {/* Connecting the owner comes first; the other actions stay one row below it. */}
      {canConnect && (
        <div className="mt-6">
          <DiscordConnectButton />
        </div>
      )}
      <div className={`${canConnect ? "mt-3" : "mt-6"} flex flex-wrap items-center gap-2.5`}>
        <InstallBotLink installUrl={installUrl} variant={canConnect ? "secondary" : "primary"}>
          {t.setup.addToServer}
          <ArrowUpRight className="size-3.5" />
        </InstallBotLink>
        <button
          className="rounded-[10px] border border-line px-4.5 py-2 text-[13.5px] text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
          onClick={onComplete}
          type="button"
        >
          {t.setup.goToDashboard}
        </button>
      </div>
      <DoneNotice canConnect={canConnect} isPublic={isPublic} />
    </div>
  );
}

function DoneNotice({ canConnect, isPublic }: { canConnect: boolean; isPublic: boolean }) {
  const { t } = useI18n();
  if (!canConnect) {
    return (
      <div className="mt-5">
        <Notice icon={<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />} tone="warn">
          {t.setup.skippedNotice}
        </Notice>
      </div>
    );
  }
  if (!isPublic) return null;
  // The OAuth callback ends the session the setup just opened.
  return (
    <div className="mt-5">
      <Notice icon={<Info className="mt-0.5 size-3.5 shrink-0" />}>
        {t.setup.publicConnectNotice}
      </Notice>
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

/** Four segments: length is the only rule, so the meter reads "short" until 15 characters. */
function PasswordMeter({ password }: { password: string }) {
  const { t } = useI18n();
  const length = [...password].length;
  const level = length === 0 ? 0 : length < 8 ? 1 : length < 15 ? 2 : length < 20 ? 3 : 4;
  const ready = length >= minimumPasswordLength;
  const fill = ready ? "bg-ok" : "bg-warn";
  const label =
    length === 0
      ? t.setup.passwordMinimum
      : ready
        ? t.setup.passwordGood(length)
        : t.setup.passwordShort(length);
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
