import { z } from "zod";

export const hardwareProfileSchema = z
  .object({
    cpuCores: z.number().int().positive().max(65536),
    cpuName: z.string().min(1).max(256).optional(),
    memoryBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    accelerators: z
      .array(
        z
          .object({
            id: z.string().min(1).max(256),
            name: z.string().min(1).max(256),
            vendor: z.enum(["amd", "apple", "intel", "nvidia", "unknown"]),
            memoryBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
          })
          .strict()
          .transform(({ memoryBytes, ...gpu }) => ({
            ...gpu,
            ...(memoryBytes === undefined ? {} : { memoryBytes }),
          })),
      )
      .max(128)
      .default([]),
  })
  .strict();

export const hardwareSnapshotSchema = z
  .object({
    detectedAt: z.iso.datetime(),
    hardware: hardwareProfileSchema,
    platform: z.enum(["win32", "linux"]),
  })
  .strict();
export type HardwareSnapshot = z.infer<typeof hardwareSnapshotSchema>;
export interface HardwareStore {
  read(): Promise<HardwareSnapshot | undefined>;
  update(snapshot: HardwareSnapshot): Promise<boolean>;
}
