import { useDiscordConnect } from "../hooks/use-discord-connection";
import { useI18n } from "../i18n/store";
import { Button, DiscordIcon, FormError } from "./ui";

export function DiscordConnectButton({
  disabled = false,
  label,
  variant = "primary",
}: {
  disabled?: boolean;
  label?: string | undefined;
  variant?: "primary" | "secondary";
}) {
  const { t } = useI18n();
  const { connect, connecting, failure } = useDiscordConnect();
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        disabled={disabled || connecting}
        onClick={() => void connect()}
        type="button"
        variant={variant}
      >
        <DiscordIcon className="size-4" />
        {connecting ? t.discordConnect.connecting : (label ?? t.discordConnect.connect)}
      </Button>
      {failure !== undefined && <FormError>{t.discordConnect.failures[failure]}</FormError>}
    </div>
  );
}
