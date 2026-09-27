import { type CatalogItem, ModelOperationError } from "./model-catalog.js";

const familyPattern = /^[a-z0-9][a-z0-9._-]{0,100}$/;
const variantPattern = /^[a-z0-9][a-z0-9._-]{0,100}:[A-Za-z0-9._-]{1,100}$/;

export function parseOllamaFamilies(html: string): CatalogItem[] {
  const families = new Set<string>();
  for (const match of html.matchAll(/href="\/library\/([^"?#]+)"/g)) {
    if (match[1] !== undefined && familyPattern.test(match[1])) families.add(match[1]);
  }
  if (families.size === 0) throw new ModelOperationError("catalog_invalid", 503);
  return [...families].map((family) => ({
    model: `${family}:latest`,
    family,
    name: family,
    sizeBytes: null,
    variantsAvailable: true,
  }));
}

export function parseOllamaVariants(html: string, family: string): CatalogItem[] {
  if (/>\s*embedding\s*</i.test(html)) return [];
  const items = new Map<string, CatalogItem>();
  for (const match of html.matchAll(/<a\b[^>]*href="\/library\/([^"?#]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const model = match[1];
    const text = (match[2] ?? "").replace(/<[^>]+>/g, " ");
    if (
      model === undefined ||
      !variantPattern.test(model) ||
      !model.startsWith(`${family}:`) ||
      /cloud/i.test(model)
    )
      continue;
    if (!/text(?:\s*,\s*(?:image|audio|video))*\s+input/i.test(text) || /embedding/i.test(text))
      continue;
    items.set(model, {
      model,
      family,
      name: model,
      sizeBytes: parseSize(text),
    });
  }
  if (!html.includes("/library/")) throw new ModelOperationError("catalog_invalid", 503);
  return [...items.values()];
}

function parseSize(text: string): number | null {
  const size = text.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)\b/i);
  if (size === null) return null;
  const units: Record<string, number> = { KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
  return Math.round(Number(size[1]) * (units[size[2]?.toUpperCase() ?? ""] ?? 1));
}

export async function readPublicLibrary(
  path: string,
  request: typeof fetch = fetch,
): Promise<string> {
  const response = await request(`https://ollama.com/library${path}`, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || response.body === null)
    throw new ModelOperationError("catalog_unavailable", 503);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 10 * 1024 * 1024) throw new ModelOperationError("catalog_invalid", 503);
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
