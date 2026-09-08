import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ApiServerDependencies } from "./server-contracts.js";
import {
  authorizeGuild,
  type GuildAccessResolver,
  refreshParticipantProfiles,
  requireAnalytics,
} from "./server-support.js";

type ParticipantProfile = { avatarUrl?: string | null; displayName: string };

function applyParticipantProfile<
  T extends { avatarUrl: string | null; displayName: string; userId: string },
>(participant: T, profiles: ReadonlyMap<string, ParticipantProfile>) {
  const profile = profiles.get(participant.userId);
  return {
    ...participant,
    avatarUrl: profile?.avatarUrl ?? participant.avatarUrl,
    displayName: profile?.displayName ?? participant.displayName,
  };
}

export function registerAnalyticsRoutes(
  app: FastifyInstance,
  dependencies: ApiServerDependencies,
  resolveGuildAccess: GuildAccessResolver,
): void {
  app.get("/api/guilds/:guildId/dashboard", async (request) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const analytics = requireAnalytics(dependencies);
    const { period } = z
      .object({ period: z.enum(["30d", "90d", "all"]).default("30d") })
      .parse(request.query);
    const [dashboard, liveMeeting] = await Promise.all([
      analytics.getDashboard(guildId, {
        period,
        timeZone: dependencies.timeZone ?? "America/Sao_Paulo",
      }),
      dependencies.liveMeetings.getForGuild(guildId),
    ]);
    const profiles = await refreshParticipantProfiles(
      guildId,
      [
        ...dashboard.topSpeakers.map((speaker) => speaker.userId),
        ...(liveMeeting?.participants.map((participant) => participant.userId) ?? []),
      ],
      dependencies,
    );
    return {
      ...dashboard,
      liveMeeting:
        liveMeeting === null
          ? null
          : {
              ...liveMeeting,
              participants: liveMeeting.participants.map((participant) =>
                applyParticipantProfile(participant, profiles),
              ),
            },
      timeZone: dependencies.timeZone ?? "America/Sao_Paulo",
      topSpeakers: dashboard.topSpeakers.map((speaker) =>
        applyParticipantProfile(speaker, profiles),
      ),
    };
  });
  app.get("/api/guilds/:guildId/meetings", async (request) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const query = z
      .object({
        dateFrom: z.iso.date().optional(),
        dateTo: z.iso.date().optional(),
        channelName: z.string().trim().min(1).max(100).optional(),
        contentRetained: z.stringbool().optional(),
        meetingId: z.string().trim().min(1).max(128).optional(),
        page: z.coerce.number().int().positive().default(1),
        participantUserId: z.string().trim().min(1).max(128).optional(),
        state: z.enum(["completed", "failed", "in_progress"]).optional(),
      })
      .parse(request.query);
    const analytics = requireAnalytics(dependencies);
    const history = await analytics.listMeetings(
      guildId,
      query.meetingId === undefined
        ? {
            ...(query.dateFrom === undefined ? {} : { dateFrom: query.dateFrom }),
            ...(query.dateTo === undefined ? {} : { dateTo: query.dateTo }),
            ...(query.channelName === undefined ? {} : { channelName: query.channelName }),
            ...(query.contentRetained === undefined
              ? {}
              : { contentRetained: query.contentRetained }),
            pageSize: 20,
            page: query.page,
            ...(query.state === undefined ? {} : { state: query.state }),
            ...(query.participantUserId === undefined
              ? {}
              : { participantUserId: query.participantUserId }),
            timeZone: dependencies.timeZone ?? "America/Sao_Paulo",
          }
        : {
            meetingId: query.meetingId,
            pageSize: 20,
            page: query.page,
            timeZone: dependencies.timeZone ?? "America/Sao_Paulo",
          },
    );
    const liveMeeting = await dependencies.liveMeetings.getForGuild(guildId);
    const itemsWithLiveParticipants = history.items.map((meeting) =>
      liveMeeting?.meetingId === meeting.meetingId
        ? {
            ...meeting,
            participants: liveMeeting.participants.map((participant) => ({
              ...participant,
              percentage: null,
              talkTimeMs: null,
            })),
          }
        : meeting,
    );
    const userIds = itemsWithLiveParticipants.flatMap(
      (meeting) => meeting.participants?.map((item) => item.userId) ?? [],
    );
    const profiles = await refreshParticipantProfiles(guildId, userIds, dependencies);
    return {
      ...history,
      items: itemsWithLiveParticipants.map((meeting) => ({
        ...meeting,
        participants:
          meeting.participants?.map((participant) =>
            applyParticipantProfile(participant, profiles),
          ) ?? null,
      })),
      timeZone: dependencies.timeZone ?? "America/Sao_Paulo",
    };
  });
  app.get("/api/guilds/:guildId/meetings/:meetingId", async (request, reply) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const { meetingId } = z.object({ meetingId: z.string().min(1).max(128) }).parse(request.params);
    const analytics = requireAnalytics(dependencies);
    const meeting = await analytics.getMeeting(guildId, meetingId);
    if (meeting === undefined) return reply.status(404).send({ error: "meeting_not_found" });
    const liveMeeting = await dependencies.liveMeetings.getForGuild(guildId);
    const participants =
      liveMeeting?.meetingId === meeting.meetingId
        ? liveMeeting.participants.map((participant) => ({
            ...participant,
            percentage: null,
            talkTimeMs: null,
          }))
        : meeting.participants;
    const profiles = await refreshParticipantProfiles(
      guildId,
      participants?.map((participant) => participant.userId) ?? [],
      dependencies,
    );
    return {
      ...meeting,
      participants:
        participants?.map((participant) => applyParticipantProfile(participant, profiles)) ?? null,
      timeZone: dependencies.timeZone ?? "America/Sao_Paulo",
    };
  });
  app.get("/api/guilds/:guildId/tasks", async (request) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const query = z
      .object({
        completed: z.stringbool().optional(),
        meetingId: z.string().min(1).max(128).optional(),
      })
      .parse(request.query);
    const tasks = await dependencies.tasks.list(guildId, {
      ...(query.completed === undefined ? {} : { completed: query.completed }),
      ...(query.meetingId === undefined ? {} : { meetingId: query.meetingId }),
    });
    const profiles = await refreshParticipantProfiles(
      guildId,
      tasks.flatMap((task) => (task.ownerUserId === null ? [] : [task.ownerUserId])),
      dependencies,
    );
    return tasks.map((task) => {
      const profile = task.ownerUserId === null ? undefined : profiles.get(task.ownerUserId);
      return {
        ...task,
        ownerAvatarUrl: profile?.avatarUrl ?? task.ownerAvatarUrl,
        ownerDisplayName: profile?.displayName ?? task.ownerDisplayName,
      };
    });
  });
  app.patch("/api/guilds/:guildId/tasks/:taskId/completion", async (request, reply) => {
    const { guildId, user } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const { taskId } = z.object({ taskId: z.uuid() }).parse(request.params);
    const { completed } = z.object({ completed: z.boolean() }).parse(request.body);
    await dependencies.tasks.setCompleted(guildId, taskId, user.userId, completed);
    return reply.status(204).send();
  });
}
