import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark">R</span>
      {!compact && <span>Summyz Community</span>}
    </div>
  );
}

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props} />;
}

export function Field({
  hint,
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { hint?: string; label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
      {hint !== undefined && <small>{hint}</small>}
    </label>
  );
}

export function SelectField({
  children,
  label,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode; label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select {...props}>{children}</select>
    </label>
  );
}

export function TextAreaField({
  hint,
  label,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { hint?: string; label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea {...props} />
      {hint !== undefined && <small>{hint}</small>}
    </label>
  );
}

export function Toggle({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
    </label>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status">
      <span />
      Preparando o Summyz Community…
    </div>
  );
}

export function EmptyState({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="empty-state">
      <div className="empty-orbit" />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
