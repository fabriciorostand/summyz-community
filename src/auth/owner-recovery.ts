interface RecoveryDiscordService {
  createAuthorizationUrl(input: { intent: "recovery" }): Promise<string>;
}

export async function createOwnerRecoveryAuthorization(
  discord: RecoveryDiscordService,
): Promise<string> {
  return discord.createAuthorizationUrl({ intent: "recovery" });
}
