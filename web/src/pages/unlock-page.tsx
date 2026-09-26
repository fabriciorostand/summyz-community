import { Check, TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { HelpTip } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { formatElapsed } from "../lib/format";

type UnlockState =
  | { kind: "form"; attempts: number; error?: "invalid_password" | "request_failed" }
  | { kind: "checking"; attempts: number }
  | { kind: "locked"; secondsLeft: number; total: number }
  | { kind: "unlocked" };

const fallbackLockSeconds = 42;

/** Maps a failed unlock attempt to the next screen state; only a 401 counts as an attempt. */
function stateAfterFailure(caught: unknown, attempts: number): UnlockState {
  if (caught instanceof ApiError && caught.status === 429) {
    const total = caught.retryAfterSeconds ?? fallbackLockSeconds;
    return { kind: "locked", secondsLeft: total, total };
  }
  const invalid = caught instanceof ApiError && caught.status === 401;
  return {
    attempts: invalid ? attempts + 1 : attempts,
    error: invalid ? "invalid_password" : "request_failed",
    kind: "form",
  };
}

/** Public mode only: one password for the whole installation, no user identity. */
export function UnlockPage({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [state, setState] = useState<UnlockState>({ attempts: 0, kind: "form" });

  useEffect(() => {
    if (state.kind !== "locked") return;
    const timer = setInterval(() => {
      setState((current) => {
        if (current.kind !== "locked") return current;
        if (current.secondsLeft <= 1) {
          setPassword("");
          return { attempts: 0, kind: "form" };
        }
        return { ...current, secondsLeft: current.secondsLeft - 1 };
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [state.kind]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind !== "form" || password.length === 0) return;
    const attempts = state.attempts;
    setState({ attempts, kind: "checking" });
    try {
      await api.login(password);
      setState({ kind: "unlocked" });
    } catch (caught) {
      setState(stateAfterFailure(caught, attempts));
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-6">
      {state.kind === "locked" ? (
        <Lockout secondsLeft={state.secondsLeft} total={state.total} />
      ) : state.kind === "unlocked" ? (
        <div className="w-full max-w-[360px]">
          <span className="mb-5 grid size-11 place-items-center rounded-xl border border-ok/40 bg-ok-soft text-ok">
            <Check className="size-5" />
          </span>
          <h2 className="m-0 text-[21px] font-semibold tracking-tight text-ink">
            Instalação desbloqueada
          </h2>
          <button
            className="mt-5 rounded-[10px] bg-action px-5 py-3 text-[14px] font-medium text-white transition-colors hover:bg-action-hover"
            onClick={onUnlocked}
            type="button"
          >
            Ir para o dashboard
          </button>
        </div>
      ) : (
        <form className="w-full max-w-[360px]" onSubmit={(event) => void submit(event)}>
          <img
            alt="Summyz"
            className="mb-5 block size-10 object-contain"
            height={40}
            src="/summyz-logo.png"
            width={40}
          />
          <div className="flex items-center gap-2">
            <h2 className="m-0 text-[21px] font-semibold tracking-tight text-ink">Desbloquear</h2>
            <HelpTip>
              Senha da instalação, não de usuário. Esqueceu? Rode{" "}
              <code className="font-mono text-accent-hover">recover-access</code> no host.
            </HelpTip>
          </div>
          <input
            aria-label="Senha da instalação"
            autoComplete="current-password"
            className={`mt-5 w-full rounded-[10px] border bg-surface px-4 py-3.5 text-base text-ink pointer-fine:text-[14px] outline-none transition-colors placeholder:text-ink-dim focus:border-action ${
              state.kind === "form" && state.error === "invalid_password"
                ? "border-fail/60"
                : "border-line-strong"
            }`}
            onChange={(event) => {
              setPassword(event.currentTarget.value);
              setState((current) =>
                current.kind === "form" ? { attempts: current.attempts, kind: "form" } : current,
              );
            }}
            placeholder="Senha da instalação"
            type="password"
            value={password}
          />
          {state.kind === "form" && state.error !== undefined && (
            <div className="mt-2.5 flex items-center gap-2" role="alert">
              <TriangleAlert className="size-3.5 shrink-0 text-fail" />
              <span className="text-[12.5px] text-fail">
                {state.error === "invalid_password"
                  ? "Senha incorreta"
                  : "Não foi possível verificar a senha"}
              </span>
              {state.error === "invalid_password" && (
                <span className="label-mono ml-auto text-ink-dim">
                  Tentativa {String(state.attempts)}
                </span>
              )}
            </div>
          )}
          <button
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-[10px] bg-action py-3.5 text-[14px] font-medium text-white transition-colors hover:bg-action-hover disabled:cursor-wait disabled:opacity-70"
            disabled={state.kind === "checking"}
            type="submit"
          >
            {state.kind === "checking" ? (
              <>
                <span className="live-dot size-1.5 rounded-full bg-white" />
                Verificando…
              </>
            ) : (
              "Entrar"
            )}
          </button>
        </form>
      )}
    </main>
  );
}

function Lockout({ secondsLeft, total }: { secondsLeft: number; total: number }) {
  return (
    <div className="w-full max-w-[360px] text-center">
      <div className="font-mono text-[40px] leading-none font-bold tracking-tight text-warn">
        {formatElapsed(secondsLeft * 1_000)}
      </div>
      <div className="mt-3 flex items-center justify-center gap-2">
        <span className="label-mono text-ink-muted">Aguarde para tentar de novo</span>
        <HelpTip>
          Bloqueio temporário deste endereço após tentativas seguidas. A instalação continua
          funcionando normalmente.
        </HelpTip>
      </div>
      <div className="mt-6 h-1 overflow-hidden rounded-full bg-surface-inset">
        <div
          className="h-full rounded-full bg-warn transition-[width] duration-1000 ease-linear"
          style={{ width: `${String(Math.round((secondsLeft / total) * 100))}%` }}
        />
      </div>
    </div>
  );
}
