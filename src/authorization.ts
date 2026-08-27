export interface RecordingAuthorizationInput {
  isGuildOwner: boolean;
  memberRoleIds: readonly string[];
  recordingRoleIds: readonly string[];
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
  return input.memberRoleIds.some((roleId) => allowedRoleIds.has(roleId));
}

export function canManageRecordingRoles(input: ManageRecordingRolesAuthorizationInput): boolean {
  return input.isGuildOwner;
}

export function canConfigureSummaryForum(input: ConfigureSummaryForumAuthorizationInput): boolean {
  return input.isGuildOwner;
}
