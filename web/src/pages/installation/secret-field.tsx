import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Button, Field, FormError } from "../../components/ui";
import { useI18n } from "../../i18n/store";
import { api, type InstallationSecret } from "../../lib/api";

/**
 * Write-only field for an installation secret: the value never comes back from the server, so
 * the placeholder only says whether one is stored.
 */
export function SecretField({
  configured,
  failedMessage,
  label,
  name,
  onChange,
  removeLabel,
}: {
  configured: boolean;
  failedMessage: string;
  label: string;
  name: InstallationSecret;
  onChange: (configured: boolean) => void;
  removeLabel: string;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(action: () => Promise<void>, nextConfigured: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      setValue("");
      onChange(nextConfigured);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <Field
          autoComplete="off"
          className="flex-1"
          label={label}
          onChange={(event) => setValue(event.currentTarget.value)}
          placeholder={configured ? t.installation.configuredReplace : t.installation.notConfigured}
          type="password"
          value={value}
        />
        <Button
          disabled={busy || value === ""}
          onClick={() => void run(() => api.updateSecret(name, value), true)}
          type="button"
          variant="secondary"
        >
          {t.installation.update}
        </Button>
        <Button
          aria-label={removeLabel}
          className="px-2.5"
          disabled={busy || !configured}
          onClick={() => void run(() => api.removeSecret(name), false)}
          type="button"
          variant="ghost"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {failed && <FormError>{failedMessage}</FormError>}
    </div>
  );
}
