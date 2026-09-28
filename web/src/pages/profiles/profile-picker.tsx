import { Select } from "../../components/select";
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
  // Long profile names shorten with an ellipsis instead of pushing the header past the screen.
  return (
    <div className="flex min-w-0 max-w-44 sm:max-w-xs">
      <Select
        aria-label="Perfil"
        onChange={onSelect}
        options={items.map((item) => {
          const profile = item.profile.profileId === selectedId ? draft : item.profile;
          return {
            label: profile.name || "Sem nome",
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
