import { z } from "zod";
import type { PostgresExecutor } from "./postgres-database.js";

const identifierSchema = z.string().min(1).max(128);

export interface GuildOwnerApprovalStore {
  confirm(guildId: string, ownerUserId: string): Promise<boolean>;
  isConfirmed(guildId: string, ownerUserId: string): Promise<boolean>;
}

export class PostgresGuildOwnerApprovalStore implements GuildOwnerApprovalStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async isConfirmed(guildId: string, ownerUserId: string): Promise<boolean> {
    const result = await this.#database.query(
      `INSERT INTO guild_owner_approvals (guild_id, owner_user_id, confirmed)
       VALUES ($1, $2, true)
       ON CONFLICT (guild_id) DO UPDATE SET
         owner_user_id = EXCLUDED.owner_user_id,
         confirmed = CASE
           WHEN guild_owner_approvals.owner_user_id = EXCLUDED.owner_user_id
             THEN guild_owner_approvals.confirmed
           ELSE false
         END,
         updated_at = CASE
           WHEN guild_owner_approvals.owner_user_id = EXCLUDED.owner_user_id
             THEN guild_owner_approvals.updated_at
           ELSE now()
         END
       RETURNING confirmed`,
      [identifierSchema.parse(guildId), identifierSchema.parse(ownerUserId)],
    );
    return z.boolean().parse(result.rows[0]?.confirmed);
  }

  public async confirm(guildId: string, ownerUserId: string): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE guild_owner_approvals
         SET confirmed = true, updated_at = now()
         WHERE guild_id = $1 AND owner_user_id = $2
         RETURNING guild_id`,
      [identifierSchema.parse(guildId), identifierSchema.parse(ownerUserId)],
    );
    return result.rowCount === 1;
  }
}
