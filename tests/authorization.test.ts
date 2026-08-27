import { describe, expect, it } from "vitest";

import {
  canConfigureSummaryForum,
  canManageRecordingRoles,
  canRecord,
} from "../src/authorization.js";

describe("autorização de gravação", () => {
  it("autoriza o dono do servidor e não concede acesso automático a administradores", () => {
    expect(canRecord({ isGuildOwner: true, memberRoleIds: [], recordingRoleIds: [] })).toBe(true);
    expect(canRecord({ isGuildOwner: false, memberRoleIds: [], recordingRoleIds: [] })).toBe(false);
  });

  it("autoriza membros que possuem um cargo configurado", () => {
    expect(
      canRecord({
        isGuildOwner: false,
        memberRoleIds: ["role-allowed"],
        recordingRoleIds: ["role-allowed", "other-role"],
      }),
    ).toBe(true);
  });

  it("nega membros sem cargo configurado", () => {
    expect(
      canRecord({
        isGuildOwner: false,
        memberRoleIds: ["unrelated-role"],
        recordingRoleIds: ["role-allowed"],
      }),
    ).toBe(false);
  });

  it("permite somente ao dono configurar cargos", () => {
    expect(canManageRecordingRoles({ isGuildOwner: true })).toBe(true);
    expect(canManageRecordingRoles({ isGuildOwner: false })).toBe(false);
  });

  it("permite somente ao dono configurar o fórum", () => {
    expect(
      canConfigureSummaryForum({
        isGuildOwner: true,
      }),
    ).toBe(true);
    expect(
      canConfigureSummaryForum({
        isGuildOwner: false,
      }),
    ).toBe(false);
  });
});
