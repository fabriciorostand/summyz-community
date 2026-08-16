import { describe, expect, it } from "vitest";

import { canManageRecordingRoles, canRecord } from "../src/authorization.js";

describe("autorização de gravação", () => {
  it("sempre autoriza administradores", () => {
    expect(canRecord({ isAdministrator: true, memberRoleIds: [], recordingRoleIds: [] })).toBe(
      true,
    );
  });

  it("autoriza membros que possuem um cargo configurado", () => {
    expect(
      canRecord({
        isAdministrator: false,
        memberRoleIds: ["role-allowed"],
        recordingRoleIds: ["role-allowed", "other-role"],
      }),
    ).toBe(true);
  });

  it("nega membros sem cargo configurado", () => {
    expect(
      canRecord({
        isAdministrator: false,
        memberRoleIds: ["unrelated-role"],
        recordingRoleIds: ["role-allowed"],
      }),
    ).toBe(false);
  });

  it("permite que Manage Guild configure os cargos", () => {
    expect(canManageRecordingRoles({ isAdministrator: false, canManageGuild: true })).toBe(true);
  });
});
