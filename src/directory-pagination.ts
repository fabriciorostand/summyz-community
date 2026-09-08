import { z } from "zod";

const directoryQueryShape = {
  query: z.string().trim().max(100).optional(),
};

export const directoryPageQuerySchema = z.object({
  ...directoryQueryShape,
  page: z.coerce.number().int().positive().default(1),
});

export const memberDirectoryPageQuerySchema = directoryPageQuerySchema.extend({
  roleId: z.string().min(1).max(128).optional(),
});

export const directoryPageOptionsSchema = z.object({
  ...directoryQueryShape,
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
});

export const memberDirectoryPageOptionsSchema = directoryPageOptionsSchema.extend({
  roleId: z.string().min(1).max(128).optional(),
});
