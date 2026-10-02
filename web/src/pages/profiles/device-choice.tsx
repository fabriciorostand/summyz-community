import { useEffect, useState } from "react";
import { Label } from "../../components/ui";
import { useHardwareVersion } from "../../hooks/use-model-catalog";
import { useI18n } from "../../i18n/store";
import { api } from "../../lib/api";
import type { Stage } from "./profile-stages";

export function DeviceChoice({
  provider,
  stage,
  value,
  onChange,
}: {
  provider: "ollama" | "faster-whisper";
  stage: Stage;
  value: "auto" | "cpu" | "gpu";
  onChange: (device: "auto" | "cpu" | "gpu") => void;
}) {
  const { t } = useI18n();
  const version = useHardwareVersion();
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: native hardware events trigger a fresh availability read.
  useEffect(() => {
    let current = true;
    setAvailable(undefined);
    api.getHardware().then(
      (report) => {
        if (current) setAvailable(report.hardware.gpuAvailability[provider]);
      },
      () => {
        if (current) setAvailable(false);
      },
    );
    return () => {
      current = false;
    };
  }, [provider, version]);
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1.5">
        <Label>{t.stagePanel.hardware}</Label>
      </legend>
      <div className="flex gap-3">
        {(["auto", "cpu", "gpu"] as const).map((device) => (
          <label
            key={device}
            className="inline-flex items-center gap-1.5 text-sm has-disabled:text-ink-muted"
          >
            <input
              type="radio"
              name={`device-${stage}`}
              value={device}
              checked={value === device}
              disabled={device === "gpu" && available !== true}
              onChange={() => onChange(device)}
            />
            {device === "auto" ? t.stagePanel.automaticDevice : device.toUpperCase()}
          </label>
        ))}
      </div>
      <p className="mt-2 mb-0 text-xs text-ink-muted">{t.stagePanel.deviceHint}</p>
      {available !== true && (
        <p aria-live="polite" className="mt-1 mb-0 text-xs text-warn">
          {available === undefined
            ? t.stagePanel.hardwareLoading
            : value === "gpu"
              ? t.stagePanel.gpuSelectionUnavailable
              : t.stagePanel.gpuUnavailable}
        </p>
      )}
    </fieldset>
  );
}
