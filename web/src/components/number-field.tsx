import { type InputHTMLAttributes, useEffect, useState } from "react";

import { Field } from "./ui";

type NumberFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "type" | "value"
> & {
  hint?: string;
  label: string;
  onCommit: (value: number) => void;
  value: number;
};

/**
 * A controlled numeric input that keeps what the operator typed in local state and only
 * publishes finite numbers upward. Without this, clearing the field to retype it would either
 * push NaN into the profile schema (which rejects it) or snap the old value back mid-edit.
 */
export function NumberField({ label, onCommit, value, ...props }: NumberFieldProps) {
  const [draft, setDraft] = useState(() => String(value));

  useEffect(() => {
    setDraft((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <Field
      {...props}
      label={label}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        setDraft(raw);
        const parsed = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(parsed)) onCommit(parsed);
      }}
      type="number"
      value={draft}
    />
  );
}

/**
 * Same idea for the optional generation knobs, where an empty field legitimately means "unset".
 */
export function OptionalNumberField({
  label,
  onCommit,
  value,
  ...props
}: Omit<NumberFieldProps, "onCommit" | "value"> & {
  onCommit: (value: number | undefined) => void;
  value: number | undefined;
}) {
  const [draft, setDraft] = useState(() => (value === undefined ? "" : String(value)));

  useEffect(() => {
    setDraft((current) => {
      if (value === undefined) return current === "" ? current : "";
      return Number(current) === value ? current : String(value);
    });
  }, [value]);

  return (
    <Field
      {...props}
      label={label}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        setDraft(raw);
        if (raw.trim() === "") {
          onCommit(undefined);
          return;
        }
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) onCommit(parsed);
      }}
      type="number"
      value={draft}
    />
  );
}

/**
 * Fields that accept either the literal "auto" or a number. The raw text stays local so that
 * typing the first letter of "auto" never publishes NaN into the profile schema, which rejects it.
 */
export function AutoNumberField({
  label,
  onCommit,
  value,
  ...props
}: Omit<NumberFieldProps, "onCommit" | "value"> & {
  onCommit: (value: "auto" | number) => void;
  value: "auto" | number;
}) {
  const [draft, setDraft] = useState(() => String(value));

  useEffect(() => {
    setDraft((current) => (current === String(value) ? current : String(value)));
  }, [value]);

  return (
    <Field
      {...props}
      label={label}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        setDraft(raw);
        if (raw === "auto") {
          onCommit("auto");
          return;
        }
        const parsed = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(parsed)) onCommit(parsed);
      }}
      value={draft}
    />
  );
}
