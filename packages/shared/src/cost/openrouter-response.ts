const JSON_DECIMAL = String.raw`((?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)`;
const COST_PATTERN = new RegExp(String.raw`(?<!\\)"cost"\s*:\s*${JSON_DECIMAL}(?=\s*[,}])`);
const TOTAL_COST_PATTERN = new RegExp(
  String.raw`(?<!\\)"total_cost"\s*:\s*${JSON_DECIMAL}(?=\s*[,}])`,
);

export interface OpenRouterResponseBody {
  body: unknown;
  exactCost?: string;
}

export async function readOpenRouterResponse(
  response: Response,
  costProperty: "cost" | "total_cost" = "cost",
): Promise<OpenRouterResponseBody> {
  const text = await response.text();
  if (text.length === 0) return { body: undefined };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { body: undefined };
  }
  const match = (costProperty === "cost" ? COST_PATTERN : TOTAL_COST_PATTERN).exec(text);
  return match?.[1] === undefined ? { body } : { body, exactCost: match[1] };
}

export function getOpenRouterGenerationId(response: Response): string | undefined {
  return response.headers.get("x-generation-id") ?? undefined;
}
