import { SelectField } from "../../components/ui";
import type { ModelDownload, Profile, ProfileListItem } from "../../lib/api";
import { availabilityLine } from "./profile-availability";
import { ProfileTypeBadge, profileTypeLabels, UsageLine } from "./profile-header";
import { profileTypeOf, stages } from "./profile-stages";

type JobFor = (provider: ModelDownload["provider"], model: string) => ModelDownload | undefined;

function modelTrail(profile: Profile): string {
  return stages.map((stage) => profile[stage].model?.split("/").at(-1) ?? "sem modelo").join(" → ");
}

/**
 * Every profile in one list, whatever runs where. The selected one reflects the edit in
 * progress; the others show what is saved. Narrow screens get a compact picker instead.
 */
export function ProfileList({
  draft,
  items,
  jobFor,
  onSelect,
  selectedId,
}: {
  draft: Profile;
  items: readonly ProfileListItem[];
  jobFor: JobFor;
  onSelect: (profileId: string) => void;
  selectedId: string;
}) {
  const shown = (item: ProfileListItem) =>
    item.profile.profileId === selectedId ? draft : item.profile;
  return (
    <>
      <div className="xl:hidden">
        <SelectField
          label="Perfil"
          onChange={onSelect}
          options={items.map((item) => {
            const profile = shown(item);
            const type = profileTypeOf(profile);
            return {
              label: `${profile.name} · ${type === null ? "Incompleto" : profileTypeLabels[type]}${item.active ? " · em uso" : ""}`,
              value: profile.profileId,
            };
          })}
          value={selectedId}
        />
      </div>
      <nav aria-label="Perfis" className="hidden flex-col gap-1.5 xl:flex">
        {items.map((item) => {
          const profile = shown(item);
          const selected = profile.profileId === selectedId;
          const line = availabilityLine(item.availability, jobFor);
          return (
            <button
              aria-current={selected}
              className={`flex flex-col gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                selected
                  ? "border-action bg-action-soft"
                  : "border-line bg-surface-raised hover:border-line-strong"
              }`}
              key={profile.profileId}
              onClick={() => onSelect(profile.profileId)}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-2">
                <strong className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                  {profile.name || "Sem nome"}
                </strong>
                <ProfileTypeBadge short type={profileTypeOf(profile)} />
              </span>
              <span className="truncate font-mono text-[10.5px] text-ink-muted">
                {modelTrail(profile)}
              </span>
              {line !== null && (
                <span
                  className={`truncate text-[11px] ${line.tone === "warn" ? "text-warn" : "text-ink-muted"}`}
                >
                  {line.text}
                </span>
              )}
              {item.activeServerCount > 0 && <UsageLine count={item.activeServerCount} />}
            </button>
          );
        })}
      </nav>
    </>
  );
}
