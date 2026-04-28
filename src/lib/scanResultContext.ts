import { getSupabaseAdmin } from "./supabaseAdmin.js";

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function collectEnergyLike(obj: unknown, depth = 0): Record<string, unknown> {
  if (depth > 6) return {};
  if (!isRecord(obj)) return {};
  const out: Record<string, unknown> = {};
  const keys = [
    "energy_dimensions",
    "dimensions",
    "scores",
    "compatibility",
    "compatibility_percent",
    "compatibilityPct",
    "overall",
    "summary",
    "reading",
    "analysis",
    "result",
    "payload",
    "data",
  ];
  for (const k of keys) {
    if (k in obj) out[k] = obj[k];
  }
  if (Object.keys(out).length === 0) {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "object" && v !== null) {
        const nested = collectEnergyLike(v, depth + 1);
        if (Object.keys(nested).length) out[k] = nested;
      }
    }
  }
  return out;
}

function pickNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function extractReportPayloadFields(payload: unknown): {
  birthdateUsed: string | null;
  zodiacLabel: string | null;
  compatibilityPercentFromSummary: number | null;
  moldaviteProfile: Record<string, unknown> | null;
  amuletProfile: Record<string, unknown> | null;
} {
  if (!isRecord(payload)) {
    return {
      birthdateUsed: null,
      zodiacLabel: null,
      compatibilityPercentFromSummary: null,
      moldaviteProfile: null,
      amuletProfile: null,
    };
  }

  const birthdateUsed = pickNonEmptyString(payload["birthdateUsed"]);

  const moldaviteV1 = payload["moldaviteV1"];
  const amuletV1 = payload["amuletV1"];
  const moldRecord = isRecord(moldaviteV1) ? moldaviteV1 : null;
  const amuletRecord = isRecord(amuletV1) ? amuletV1 : null;

  const zFromMold = moldRecord ? pickNonEmptyString(moldRecord["zodiacLabel"]) : null;
  const zFromAmulet = amuletRecord ? pickNonEmptyString(amuletRecord["zodiacLabel"]) : null;
  const zodiacLabel = zFromMold ?? zFromAmulet ?? null;

  let compatibilityPercentFromSummary: number | null = null;
  const summary = payload["summary"];
  if (isRecord(summary)) {
    const n = pickNumber(summary, ["compatibilityPercent"]);
    if (n !== undefined) compatibilityPercentFromSummary = n;
  }

  return {
    birthdateUsed,
    zodiacLabel,
    compatibilityPercentFromSummary,
    moldaviteProfile: moldRecord,
    amuletProfile: amuletRecord,
  };
}

export async function buildScanResultPromptContext(
  sourceId: string
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("scan_results_v2")
    .select("*")
    .eq("id", sourceId)
    .maybeSingle();

  if (error) throw new Error(`scan_results_v2 fetch failed: ${error.message}`);
  if (!data) throw new Error(`scan_results_v2 not found for id=${sourceId}`);

  const row = data as Record<string, unknown>;
  const reportPayload = row["report_payload_json"];

  const extracted = extractReportPayloadFields(reportPayload);

  const compat =
    extracted.compatibilityPercentFromSummary ??
    pickNumber(row, [
      "compatibility_percent",
      "compatibilityPct",
      "compatibility",
    ]) ??
    (isRecord(row["result"])
      ? pickNumber(row["result"] as Record<string, unknown>, [
          "compatibility_percent",
          "compatibilityPct",
          "compatibility",
        ])
      : undefined);

  const structured = collectEnergyLike(row);
  const payload: Json = {
    scan_result_id: row.id ?? sourceId,
    birthdate_used: extracted.birthdateUsed,
    zodiac_label: extracted.zodiacLabel,
    compatibility_percent: compat ?? null,
    moldavite_profile: extracted.moldaviteProfile,
    amulet_profile: extracted.amuletProfile,
    structured_energy_fields: structured,
  };

  return JSON.stringify(payload, null, 2);
}
