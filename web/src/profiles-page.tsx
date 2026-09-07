import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";

import { api, type Profile, type ProfileListItem, type User } from "./api";
import { Button, EmptyState, Loading } from "./components";

import { Page } from "./dashboard-shared";
import { ProfileEditor } from "./profile-editor";

export function ProfilesPage() {
  const user = useOutletContext<User>();
  const [items, setItems] = useState<ProfileListItem[]>();
  const [profileType, setProfileType] = useState<Profile["profileType"]>("external");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const loadProfiles = useCallback(async () => {
    setLoadError(false);
    setItems(undefined);
    try {
      const next = await api.listProfiles();
      setItems(next);
      setSelectedProfileId(initialExternalProfileId(next));
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);
  if (loadError) {
    return (
      <Page
        title="Não foi possível carregar seus perfis"
        eyebrow="Perfis pessoais"
        description="Não foi possível concluir a consulta necessária. Tente novamente."
      >
        <EmptyState title="Perfis indisponíveis">
          <Button onClick={() => void loadProfiles()} type="button">
            Tentar novamente
          </Button>
        </EmptyState>
      </Page>
    );
  }
  if (items === undefined) return <Loading />;
  return (
    <LoadedProfiles
      items={items}
      locale={user.dashboardLanguage}
      profileType={profileType}
      selectedProfileId={selectedProfileId}
      setItems={setItems}
      setProfileType={setProfileType}
      setSelectedProfileId={setSelectedProfileId}
    />
  );
}

function initialExternalProfileId(items: readonly ProfileListItem[]): string | null {
  return items.find((item) => item.profile.profileType === "external")?.profile.profileId ?? null;
}

function LoadedProfiles({
  items,
  locale,
  profileType,
  selectedProfileId,
  setItems,
  setProfileType,
  setSelectedProfileId,
}: {
  items: ProfileListItem[];
  locale: "en" | "pt-BR";
  profileType: Profile["profileType"];
  selectedProfileId: string | null;
  setItems(value: ProfileListItem[]): void;
  setProfileType(value: Profile["profileType"]): void;
  setSelectedProfileId(value: string | null): void;
}) {
  const visibleItems = items.filter((item) => item.profile.profileType === profileType);
  const selected = selectedProfile(visibleItems, selectedProfileId);
  function selectType(nextType: Profile["profileType"]) {
    setProfileType(nextType);
    setSelectedProfileId(firstProfileId(items, nextType));
  }
  return (
    <Page
      title="Seus perfis"
      eyebrow="Configuração global"
      description="Crie configurações pessoais e escolha qual delas cada servidor deve usar."
    >
      <div className="profile-type-tabs" role="tablist" aria-label="Tipo de execução">
        <button
          aria-selected={profileType === "external"}
          className={profileType === "external" ? "active" : ""}
          onClick={() => selectType("external")}
          role="tab"
          type="button"
        >
          API externa
        </button>
        <button
          aria-selected={profileType === "local"}
          className={profileType === "local" ? "active" : ""}
          onClick={() => selectType("local")}
          role="tab"
          type="button"
        >
          Local
        </button>
      </div>
      <ProfileEditor
        items={visibleItems}
        locale={locale}
        selected={selected}
        selectedProfileId={selected?.profileId ?? null}
        onItemsChange={(nextVisible) =>
          setItems([
            ...items.filter((item) => item.profile.profileType !== profileType),
            ...nextVisible,
          ])
        }
        onSelect={setSelectedProfileId}
      />
    </Page>
  );
}

function selectedProfile(
  items: readonly ProfileListItem[],
  profileId: string | null,
): Profile | null {
  const selected = items.find((item) => item.profile.profileId === profileId);
  if (selected !== undefined) return selected.profile;
  return items[0]?.profile ?? null;
}

function firstProfileId(
  items: readonly ProfileListItem[],
  profileType: Profile["profileType"],
): string | null {
  return items.find((item) => item.profile.profileType === profileType)?.profile.profileId ?? null;
}
