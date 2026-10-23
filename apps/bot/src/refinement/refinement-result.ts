import { z } from "zod";

export const refinementEntrySchema = z.object({
  endedAtMs: z.number().int().nonnegative(),
  id: z.string().min(1),
  speaker: z.string().min(1),
  startedAtMs: z.number().int().nonnegative(),
  text: z.string().trim().min(1),
});
export type RefinementEntry = z.infer<typeof refinementEntrySchema>;

export const refinementBlockSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1),
});
export type RefinementBlock = z.infer<typeof refinementBlockSchema>;

export function applyRefinement(
  input: readonly RefinementEntry[],
  output: readonly RefinementBlock[],
): RefinementEntry[] {
  const entries = input.map((entry) => refinementEntrySchema.parse(entry));
  const blocks = output.map((block) => refinementBlockSchema.parse(block));
  if (
    entries.length !== blocks.length ||
    entries.some((entry, index) => entry.id !== blocks[index]?.id)
  ) {
    throw new Error("O refinamento alterou a estrutura da transcrição");
  }
  return entries.map((entry, index) => ({ ...entry, text: blocks[index]?.text ?? entry.text }));
}
