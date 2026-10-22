import { z } from "zod";

const userProfileSchema = z.object({
  avatar: z
    .string()
    .regex(/^(?:a_)?[a-f0-9]{32}$/u)
    .nullable(),
  discriminator: z.string().regex(/^(?:0|[0-9]{4})$/u),
  global_name: z.string().min(1).max(128).nullable().optional(),
  id: z.string().regex(/^[0-9]{1,20}$/u),
  username: z.string().min(1).max(128),
});

export function parseDiscordUserProfile(payload: unknown): {
  avatarUrl: string;
  discordUserId: string;
  discordUsername: string;
} {
  const user = userProfileSchema.parse(payload);
  const defaultIndex =
    user.discriminator === "0"
      ? Number((BigInt(user.id) >> 22n) % 6n)
      : Number(user.discriminator) % 5;
  const extension = user.avatar?.startsWith("a_") === true ? "gif" : "png";
  return {
    avatarUrl:
      user.avatar === null
        ? `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`
        : `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`,
    discordUserId: user.id,
    discordUsername: user.global_name ?? user.username,
  };
}
