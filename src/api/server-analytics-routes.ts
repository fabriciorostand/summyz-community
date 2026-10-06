import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MeetingHistoryFilters } from "../database/postgres-analytics-store.js";
import { directoryPageQuerySchema } from "../directory-pagination.js";
import {
  calendarQuerySchema,
  exportPresentationSchema,
  timeZoneSchema,
} from "./date-presentation.js";
import { createMeetingTextExport, MeetingExportUnavailableError } from "./meeting-export.js";

import type { ApiServerDependencies } from "./server-contracts.js";
import {
  authorizeGuild,
  authorizeHistoricalGuild,
  type GuildAccessResolver,
  parseRequestInput,
  refreshParticipantProfiles,
  requireAnalytics,
  runApiDependency,
} from "./server-support.js";

type ParticipantProfile = { avatarUrl?: string | null; displayName: string };

const meetingListQuerySchema = z.object({
  timeZone: timeZoneSchema,
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  channelName: z.string().trim().min(1).max(100).optional(),
  contentRetained: z.stringbool().optional(),
  meetingId: z.string().trim().min(1).max(128).optional(),
  page: z.coerce.number().int().positive().default(1),
  participantUserId: z.string().trim().min(1).max(128).optional(),
  state: z.enum(["completed", "failed", "in_progress"]).optional(),
});

const costDetailQuerySchema = z
  .object({ dateFrom: z.iso.date(), dateTo: z.iso.date(), timeZone: timeZoneSchema })
  .refine((query) => query.dateFrom <= query.dateTo, {
    message: "dateFrom must not be after dateTo",
    path: ["dateFrom"],
  });

const meetingHistoryFilters = (
  query: z.infer<typeof meetingListQuerySchema>,
  timeZone: string,
): MeetingHistoryFilters => {
  const common = { page: query.page, pageSize: 20, timeZone };
  if (query.meetingId !== undefined) return { ...common, meetingId: query.meetingId };
  return {
    ...common,
    ...(query.dateFrom === undefined ? {} : { dateFrom: query.dateFrom }),
    ...(query.dateTo === undefined ? {} : { dateTo: query.dateTo }),
    ...(query.channelName === undefined ? {} : { channelName: query.channelName }),
    ...(query.contentRetained === undefined ? {} : { contentRetained: query.contentRetained }),
    ...(query.state === undefined ? {} : { state: query.state }),
    ...(query.participantUserId === undefined
      ? {}
      : { participantUserId: query.participantUserId }),
  };
};

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
    const { guildId } = await authorizeHistoricalGuild(request, dependencies, resolveGuildAccess);
    const { period, timeZone } = parseRequestInput(
      z.object({ period: z.enum(["30d", "90d", "all"]).default("30d"), timeZone: timeZoneSchema }),
      request.query,
    );
    const analytics = requireAnalytics(dependencies);
    const [dashboard, liveMeeting] = await Promise.all([
      analytics.getDashboard(guildId, {
        period,
        timeZone,
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
      timeZone,
      topSpeakers: dashboard.topSpeakers.map((speaker) =>
        applyParticipantProfile(speaker, profiles),
      ),
    };
  });
  app.get("/api/guilds/:guildId/costs", async (request) => {
    const { guildId } = await authorizeHistoricalGuild(request, dependencies, resolveGuildAccess);
    const query = parseRequestInput(costDetailQuerySchema, request.query);
    const detail = await requireAnalytics(dependencies).getCostDetail(guildId, query);
    return { ...detail, ...query };
  });
  app.get("/api/guilds/:guildId/meetings", async (request) => {
    const { guildId } = await authorizeHistoricalGuild(request, dependencies, resolveGuildAccess);
    const query = parseRequestInput(meetingListQuerySchema, request.query);
    const { timeZone } = query;
    const analytics = requireAnalytics(dependencies);
    const history = await analytics.listMeetings(
      guildId,
      meetingHistoryFilters(query, query.timeZone),
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
      timeZone,
    };
  });
  app.get("/api/guilds/:guildId/meetings/:meetingId", async (request, reply) => {
    const { guildId } = await authorizeHistoricalGuild(request, dependencies, resolveGuildAccess);
    const { timeZone } = parseRequestInput(calendarQuerySchema, request.query);
    const { meetingId } = parseRequestInput(
      z.object({ meetingId: z.string().min(1).max(128) }),
      request.params,
    );
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
      timeZone,
    };
  });
  app.get("/api/guilds/:guildId/meetings/:meetingId/export", async (request, reply) => {
    const { guildId } = await authorizeHistoricalGuild(request, dependencies, resolveGuildAccess);
    const presentation = parseRequestInput(exportPresentationSchema, request.query);
    const { meetingId } = parseRequestInput(
      z.object({ meetingId: z.string().min(1).max(128) }),
      request.params,
    );
    const meeting = await requireAnalytics(dependencies).getMeeting(guildId, meetingId);
    if (meeting === undefined) return reply.status(404).send({ error: "meeting_not_found" });
    try {
      const content = createMeetingTextExport(meeting, presentation);
      return reply
        .header("content-type", "text/plain; charset=utf-8")
        .header("content-disposition", 'attachment; filename="summyz-meeting.txt"')
        .send(content);
    } catch (error) {
      if (error instanceof MeetingExportUnavailableError) {
        return reply.status(409).send({ error: error.message });
      }
      throw error;
    }
  });
  app.get("/api/guilds/:guildId/participants", async (request) => {
    const { guildId } = await authorizeHistoricalGuild(request, dependencies, resolveGuildAccess);
    const query = parseRequestInput(directoryPageQuerySchema, request.query);
    return runApiDependency("database", "list_meeting_participants", () =>
      dependencies.participants.list(guildId, {
        page: query.page,
        pageSize: 50,
        ...(query.query === undefined ? {} : { query: query.query }),
      }),
    );
  });
  app.get("/api/guilds/:guildId/tasks", async (request) => {
    const { guildId } = await authorizeHistoricalGuild(request, dependencies, resolveGuildAccess);
    const query = parseRequestInput(
      z.object({
        completed: z.stringbool().optional(),
        meetingId: z.string().min(1).max(128).optional(),
      }),
      request.query,
    );
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
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const { taskId } = parseRequestInput(z.object({ taskId: z.uuid() }), request.params);
    const { completed } = parseRequestInput(z.object({ completed: z.boolean() }), request.body);
    await dependencies.tasks.setCompleted(guildId, taskId, null, completed);
    return reply.status(204).send();
  });
}
