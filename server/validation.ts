export const GROUPS = [
  "style",
  "layout",
  "enter",
  "hold",
  "exit",
  "decor",
  "treat",
  "bg",
  "cam",
  "trans",
] as const;
export class AiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function check(ok: unknown, message = "Invalid arrangement data."): asserts ok {
  if (!ok) throw new AiError("invalid_request", message);
}
function object(x: any, keys: readonly string[]) {
  check(x && typeof x === "object" && !Array.isArray(x));
  check(Object.keys(x).every((k) => keys.includes(k)));
}
function string(x: any, max: number, empty = false) {
  check(
    typeof x === "string" && x.length <= max && (empty || x.trim().length > 0),
  );
}
export type ArrangementRequest = ReturnType<typeof validateRequest>;
export function validateRequest(x: any) {
  object(x, ["provider", "model", "direction", "lines", "catalog", "audioFeatures"]);
  string(x.provider, 200);
  string(x.model, 300);
  string(x.direction, 2000, true);
  check(Array.isArray(x.lines) && x.lines.length > 0 && x.lines.length <= 200);
  let chars = 0;
  const indexes = new Set();
  for (const l of x.lines) {
    object(l, ["index", "text", "start", "end", "locked"]);
    check(
      Number.isSafeInteger(l.index) && l.index >= 0 && !indexes.has(l.index),
    );
    indexes.add(l.index);
    string(l.text, 30000);
    chars += l.text.length;
    check(
      Number.isFinite(l.start) &&
        Number.isFinite(l.end) &&
        l.start >= 0 &&
        l.end >= l.start &&
        typeof l.locked === "boolean",
    );
  }
  check(chars <= 30000);
  check(
    x.lines.some((l: any) => !l.locked),
    "No unlocked lyric lines.",
  );
  if (x.audioFeatures !== undefined) {
    const features = x.audioFeatures;
    object(features, ["duration", "bpm", "lines"]);
    check(Number.isFinite(features.duration) && features.duration > 0 && features.duration <= 86400);
    check(features.bpm === null || (Number.isFinite(features.bpm) && features.bpm > 0 && features.bpm <= 400));
    check(Array.isArray(features.lines) && features.lines.length === x.lines.length);
    const remaining = new Set(x.lines.map((l: any) => l.index));
    for (const line of features.lines) {
      object(line, ["index", "energy", "beatCount"]);
      check(Number.isSafeInteger(line.index) && remaining.delete(line.index));
      check(line.energy === null || (Number.isFinite(line.energy) && line.energy >= 0 && line.energy <= 1));
      check(Number.isSafeInteger(line.beatCount) && line.beatCount >= 0 && line.beatCount <= 100000);
    }
  }
  object(x.catalog, GROUPS);
  for (const group of GROUPS) {
    const list = x.catalog[group];
    check(Array.isArray(list) && list.length <= 36);
    const ids = new Set();
    for (const item of list) {
      object(item, ["id", "name", "tags"]);
      string(item.id, 120);
      string(item.name, 200);
      check(!ids.has(item.id));
      ids.add(item.id);
      if (item.tags !== undefined) {
        check(Array.isArray(item.tags) && item.tags.length <= 12);
        for (const tag of item.tags) string(tag, 80);
      }
    }
  }
  return x as {
    provider: string;
    model: string;
    direction: string;
    audioFeatures?: { duration: number; bpm: number | null; lines: { index: number; energy: number | null; beatCount: number }[] };
    lines: {
      index: number;
      text: string;
      start: number;
      end: number;
      locked: boolean;
    }[];
    catalog: Record<
      (typeof GROUPS)[number],
      { id: string; name: string; tags?: string[] }[]
    >;
  };
}
export function validatePlan(x: any, request: ArrangementRequest) {
  try {
    object(x, ["summary", "style", "lines"]);
    string(x.summary, 2000);
    const allowed = (group: string, id: any) => {
      string(id, 120);
      check(
        request.catalog[group as (typeof GROUPS)[number]].some(
          (i) => i.id === id,
        ),
      );
    };
    if (x.style !== undefined) allowed("style", x.style);
    const expected = new Set(
      request.lines.filter((l) => !l.locked).map((l) => l.index),
    );
    check(Array.isArray(x.lines) && x.lines.length === expected.size);
    for (const line of x.lines) {
      object(line, ["index", "reason", ...GROUPS.filter((g) => g !== "style")]);
      check(Number.isSafeInteger(line.index) && expected.delete(line.index));
      string(line.reason, 1000);
      for (const group of GROUPS) {
        if (group === "style" || line[group] === undefined) continue;
        if (group === "decor") {
          check(
            Array.isArray(line.decor) &&
              line.decor.length <= 3 &&
              new Set(line.decor).size === line.decor.length,
          );
          for (const id of line.decor) allowed(group, id);
        } else allowed(group, line[group]);
      }
    }
    check(expected.size === 0);
    check(
      x.lines.every((line: any) =>
        GROUPS.some((g) => g !== "style" && line[g] !== undefined),
      ),
    );
    return x;
  } catch {
    throw new AiError(
      "invalid_plan",
      "The model returned an invalid arrangement. Please retry.",
      502,
    );
  }
}
