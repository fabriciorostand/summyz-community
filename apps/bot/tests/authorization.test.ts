import { describe, expect, it } from "vitest";

import {
  canConfigureSummaryForum,
  canManageRecordingRoles,
  canRecord,
} from "../src/authorization.js";

describe("autorização de gravação", () => {
  it("autoriza o dono do servidor e não concede acesso automático a administradores", () => {
    expect(
      canRecord({
        isGuildOwner: true,
        memberJoinedAt: null,
        memberRoleIds: [],
        memberUserId: "owner-1",
        recordingRoleIds: [],
        recordingUserGrants: [],
      }),
    ).toBe(true);
    expect(
      canRecord({
        isGuildOwner: false,
        memberJoinedAt: "2026-09-01T12:00:00.000Z",
        memberRoleIds: [],
        memberUserId: "admin-1",
        recordingRoleIds: [],
        recordingUserGrants: [],
      }),
    ).toBe(false);
  });

  it("autoriza membros que possuem um cargo configurado", () => {
    expect(
      canRecord({
        isGuildOwner: false,
        memberJoinedAt: null,
        memberRoleIds: ["role-allowed"],
        memberUserId: "user-1",
        recordingRoleIds: ["role-allowed", "other-role"],
        recordingUserGrants: [],
      }),
    ).toBe(true);
  });

  it("nega membros sem cargo configurado", () => {
    expect(
      canRecord({
        isGuildOwner: false,
        memberJoinedAt: null,
        memberRoleIds: ["unrelated-role"],
        memberUserId: "user-1",
        recordingRoleIds: ["role-allowed"],
        recordingUserGrants: [],
      }),
    ).toBe(false);
  });

  it("authorizes only the Discord membership that received an individual grant", () => {
    const input = {
      isGuildOwner: false,
      memberJoinedAt: "2026-09-01T12:00:00.000Z",
      memberRoleIds: [] as string[],
      memberUserId: "user-1",
      recordingRoleIds: [] as string[],
      recordingUserGrants: [{ memberJoinedAt: "2026-09-01T12:00:00.000Z", userId: "user-1" }],
    };

    expect(canRecord(input)).toBe(true);
    expect(canRecord({ ...input, memberJoinedAt: "2026-09-08T12:00:00.000Z" })).toBe(false);
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
