export interface RecordingAuthorizationInput {
  isAdministrator: boolean;
  memberRoleIds: readonly string[];
  recordingRoleIds: readonly string[];
}

export interface ManageRecordingRolesAuthorizationInput {
  canManageGuild: boolean;
  isAdministrator: boolean;
}

export function canRecord(input: RecordingAuthorizationInput): boolean {
  if (input.isAdministrator) {
    return true;
  }

  const allowedRoleIds = new Set(input.recordingRoleIds);
  return input.memberRoleIds.some((roleId) => allowedRoleIds.has(roleId));
}

export function canManageRecordingRoles(input: ManageRecordingRolesAuthorizationInput): boolean {
  return input.isAdministrator || input.canManageGuild;
}
