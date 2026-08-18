import { describe, expect, it } from "vitest";

import {
  canConfigureSummaryForum,
  canManageRecordingRoles,
  canRecord,
} from "../src/authorization.js";

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

  it("permite configurar o fórum com administração, Manage Guild ou cargo de gravação", () => {
    expect(
      canConfigureSummaryForum({
        canManageGuild: false,
        isAdministrator: true,
        memberRoleIds: [],
        recordingRoleIds: [],
      }),
    ).toBe(true);
    expect(
      canConfigureSummaryForum({
        canManageGuild: true,
        isAdministrator: false,
        memberRoleIds: [],
        recordingRoleIds: [],
      }),
    ).toBe(true);
    expect(
      canConfigureSummaryForum({
        canManageGuild: false,
        isAdministrator: false,
        memberRoleIds: ["role-allowed"],
        recordingRoleIds: ["role-allowed"],
      }),
    ).toBe(true);
    expect(
      canConfigureSummaryForum({
        canManageGuild: false,
        isAdministrator: false,
        memberRoleIds: ["role-other"],
        recordingRoleIds: ["role-allowed"],
      }),
    ).toBe(false);
  });
});
