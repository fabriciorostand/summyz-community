import { TriangleAlert } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, Field } from "../components/ui";
import { ApiError, api } from "../lib/api";

export function AuthFrame({ children, title }: { children: ReactNode; title: string }) {
  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-2">
      <section className="hidden flex-col justify-between gap-10 border-r border-line-soft bg-surface-rail p-12 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-action text-[13px] font-bold text-white">
            S
          </span>
          <span className="text-[14.5px] font-semibold tracking-tight text-ink">
            Summyz Community
          </span>
        </div>
        <div>
          <p className="label-mono m-0 mb-4 text-accent">Self-hosted · seus dados ficam com você</p>
          <h2 className="m-0 max-w-lg text-[34px] leading-tight font-semibold tracking-tight text-ink">
            Conversas viram decisões. Decisões viram movimento.
          </h2>
          <p className="m-0 mt-4 max-w-md text-[14px] leading-relaxed text-ink-muted">
            Configure gravação, transcrição e resumos do seu servidor sem perder o controle dos
            dados.
          </p>
          <div className="mt-7 flex flex-wrap gap-2">
            {["Por falante", "Transcrição local", "Postgres", "Custo auditável"].map((tag) => (
              <span
                className="label-mono rounded border border-line bg-surface-raised px-2.5 py-1.5 text-ink-secondary"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
        <p className="m-0 text-[12.5px] text-ink-dim">
          Feito para equipes que preferem clareza a mais uma reunião.
        </p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <p className="label-mono m-0 mb-3 text-ink-muted">Acesso seguro</p>
          <h1 className="m-0 mb-6 text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
          {children}
        </div>
      </section>
    </main>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
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
    <AuthFrame title="Entrar">
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <Field
          autoComplete="email"
          label="E-mail"
          name="email"
          placeholder="voce@empresa.com"
          required
          type="email"
        />
        <Field
          autoComplete="current-password"
          label="Senha"
          name="password"
          placeholder="••••••••••••"
          required
          type="password"
        />
        {error !== undefined && (
          <p
            className="m-0 flex items-center gap-2 rounded-lg border border-fail/30 bg-fail-soft px-3 py-2.5 text-[12.5px] text-fail"
            role="alert"
          >
            <TriangleAlert className="size-3.5 shrink-0" />
            {error}
          </p>
        )}
        <Button disabled={busy} type="submit">
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </AuthFrame>
  );
}
