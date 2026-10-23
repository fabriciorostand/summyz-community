export type GuildAccessDecision = "account_not_connected" | "allowed" | "different_owner";

export function evaluateGuildAccess(input: {
  connectedUserId: string | null;
  guildOwnerId: string;
}): GuildAccessDecision {
  if (input.connectedUserId === null) return "account_not_connected";
  return input.connectedUserId === input.guildOwnerId ? "allowed" : "different_owner";
}
