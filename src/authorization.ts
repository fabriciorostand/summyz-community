export interface RecordingAuthorizationInput {
  isGuildOwner: boolean;
  memberJoinedAt: string | null;
  memberRoleIds: readonly string[];
  memberUserId: string;
  recordingRoleIds: readonly string[];
  recordingUserGrants: readonly { memberJoinedAt: string; userId: string }[];
}

export interface ManageRecordingRolesAuthorizationInput {
  isGuildOwner: boolean;
}

export interface ConfigureSummaryForumAuthorizationInput {
  isGuildOwner: boolean;
}

export function canRecord(input: RecordingAuthorizationInput): boolean {
  if (input.isGuildOwner) {
    return true;
  }

  const allowedRoleIds = new Set(input.recordingRoleIds);
  if (input.memberRoleIds.some((roleId) => allowedRoleIds.has(roleId))) return true;
  if (input.memberJoinedAt === null) return false;
  return input.recordingUserGrants.some(
    (grant) => grant.userId === input.memberUserId && grant.memberJoinedAt === input.memberJoinedAt,
  );
}

export function canManageRecordingRoles(input: ManageRecordingRolesAuthorizationInput): boolean {
  return input.isGuildOwner;
}

export function canConfigureSummaryForum(input: ConfigureSummaryForumAuthorizationInput): boolean {
  return input.isGuildOwner;
}
