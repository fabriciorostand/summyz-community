import type { Logger } from "pino";

import type { PostgresMeetingStore } from "./database/postgres-meeting-store.js";
import type { GuildDepartureHandler } from "./discord/guild-departure-handler.js";
import type { GuildMembershipVerifier } from "./discord/guild-membership-verifier.js";
import type { GuildOwnerVerifier } from "./discord/guild-owner-verifier.js";
import type { GuildAccessResult } from "./discord/guild-ownership-handler.js";
import { isProvenRecordedOwnerTransfer } from "./discord/meeting-publication-policy.js";
import type { VoiceChannelDeletionVerifier } from "./discord/voice-channel-deletion-verifier.js";
import type { DiscordRecordingFactory } from "./recording/discord-recording-factory.js";
import type { RecordingManifest } from "./recording/manifest.js";
import type { ManifestStore } from "./recording/manifest-store.js";
import type { RecordingCoordinator } from "./recording/recording-coordinator.js";
import {
  hasRecoveryWindowExpired,
  interruptAfterRestart,
  recoverRecording,
  shouldAttemptPendingRecovery,
} from "./recording/recovery.js";

interface RecordingRecoveryOptions {
  readonly checkGuildAccess: (guildId: string) => Promise<GuildAccessResult>;
  readonly coordinator: RecordingCoordinator;
  readonly departureHandler: GuildDepartureHandler;
  readonly guildOwnerVerifier: GuildOwnerVerifier;
  readonly logger: Logger;
  readonly manifestStore: ManifestStore;
  readonly membershipVerifier: GuildMembershipVerifier;
  readonly postgresMeetingStore: PostgresMeetingStore;
  readonly previousBotHeartbeatAt: string | undefined;
  readonly recordingFactory: DiscordRecordingFactory;
  readonly voiceChannelDeletionVerifier: VoiceChannelDeletionVerifier;
}

export async function reconcilePendingRecordings(options: RecordingRecoveryOptions): Promise<void> {
  const { coordinator, logger, manifestStore } = options;
  let manifests: RecordingManifest[];
  try {
    manifests = (await manifestStore.listRecoverable()).filter(shouldAttemptPendingRecovery);
  } catch (error) {
    logger.error({ errorType: getErrorType(error) }, "Unable to list recoverable recordings");
    return;
  }
  for (const manifest of manifests) {
    if (needsRecoveryLock(manifest, options)) {
      coordinator.setRecoverable(manifest.guildId, true);
    }
  }
  for (const manifest of manifests) {
    if (
      coordinator.get(manifest.guildId) !== undefined ||
      coordinator.isPending(manifest.guildId)
    ) {
      continue;
    }
    await attemptRecordingRecovery(manifest, options);
  }
  try {
    const stillRecoverable = (await manifestStore.listRecoverable()).filter(
      shouldAttemptPendingRecovery,
    );
    for (const guildId of new Set(manifests.map((manifest) => manifest.guildId))) {
      coordinator.setRecoverable(
        guildId,
        stillRecoverable.some(
          (manifest) => manifest.guildId === guildId && needsRecoveryLock(manifest, options),
        ),
      );
    }
  } catch (error) {
    logger.error({ errorType: getErrorType(error) }, "Unable to reconcile recoverable recordings");
  }
}

function needsRecoveryLock(
  manifest: RecordingManifest,
  options: RecordingRecoveryOptions,
): boolean {
  const { coordinator } = options;
  return (
    !coordinator.isPending(manifest.guildId) &&
    coordinator.get(manifest.guildId)?.meetingId !== manifest.meetingId
  );
}

async function attemptRecordingRecovery(
  manifest: RecordingManifest,
  options: RecordingRecoveryOptions,
): Promise<void> {
  const {
    checkGuildAccess,
    coordinator,
    departureHandler,
    guildOwnerVerifier,
    logger,
    manifestStore,
    membershipVerifier,
    postgresMeetingStore,
    previousBotHeartbeatAt,
    recordingFactory,
    voiceChannelDeletionVerifier,
  } = options;
  try {
    if (!(await postgresMeetingStore.isProcessable(manifest.meetingId))) return;
    const recoverable = interruptAfterRestart(manifest, previousBotHeartbeatAt);
    if (recoverable !== manifest) await manifestStore.save(recoverable);
    if ((await membershipVerifier.check(recoverable.guildId)) === "absent") {
      await departureHandler.handle(recoverable.guildId);
      return;
    }
    const access = await checkGuildAccess(recoverable.guildId);
    if (recoverable.verifiedOwnerUserId !== undefined) {
      const recordedOwnerCheck = await guildOwnerVerifier.check(
        recoverable.guildId,
        recoverable.verifiedOwnerUserId,
      );
      if (isProvenRecordedOwnerTransfer(recoverable, recordedOwnerCheck)) {
        await recordingFactory.finalizeWithoutResuming(recoverable, "owner_changed");
        return;
      }
    }
    const channelAvailability = await voiceChannelDeletionVerifier.check(
      recoverable.guildId,
      recoverable.voiceChannelId,
      recoverable.startedAt,
    );
    if (channelAvailability === "deleted") {
      await recordingFactory.finalizeWithoutResuming(
        recoverable,
        access.status === "unknown" ? "voice_channel_deleted_unverified" : "voice_channel_deleted",
      );
      return;
    }
    if (hasRecoveryWindowExpired(recoverable, new Date().toISOString())) {
      await recordingFactory.finalizeWithoutResuming(recoverable, "recovery_expired");
      return;
    }
    await recoverRecording(recoverable, {
      checkAccess: async () => access.status,
      finalize: (pending) => recordingFactory.finalizeWithoutResuming(pending),
      resume: (pending) => coordinator.resume(pending),
    });
  } catch (error) {
    logger.error(
      {
        errorType: getErrorType(error),
        guildId: manifest.guildId,
        meetingId: manifest.meetingId,
      },
      "Recording recovery attempt failed",
    );
  }
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
