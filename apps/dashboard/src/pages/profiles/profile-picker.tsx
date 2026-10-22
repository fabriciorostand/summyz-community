import { Select } from "../../components/select";
import { useI18n } from "../../i18n/store";
import type { Profile, ProfileListItem } from "../../lib/api";
import { ProfileTypeBadge } from "./profile-header";
import { profileTypeOf } from "./profile-stages";

/**
 * Every profile in one header picker, like the guild picker. The selected one reflects the edit
 * in progress; the others show what is saved.
 */
export function ProfilePicker({
  draft,
  items,
  onSelect,
  selectedId,
}: {
  draft: Profile;
  items: readonly ProfileListItem[];
  onSelect: (profileId: string) => void;
  selectedId: string;
}) {
  const { profilePicker } = useI18n().t;
  // Long profile names shorten with an ellipsis instead of pushing the header past the screen.
  return (
    <div className="flex min-w-0 max-w-44 sm:max-w-xs">
      <Select
        aria-label={profilePicker.label}
        onChange={onSelect}
        options={items.map((item) => {
          const profile = item.profile.profileId === selectedId ? draft : item.profile;
          return {
            label: profile.name || profilePicker.unnamed,
            trailing: <ProfileTypeBadge type={profileTypeOf(profile)} />,
            value: profile.profileId,
          };
        })}
        value={selectedId}
        variant="toolbar"
      />
    </div>
  );
}
