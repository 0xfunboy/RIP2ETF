import { rip2etfSettings } from "../settings";
import { getJSON } from "../utils/fetcher";

interface FredObservation {
  date: string;
  value: string;
}

export async function fredSeries(seriesId: string, limit = 365) {
  const key = rip2etfSettings.FRED_API_KEY;
  if (!key) return null;

  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
    seriesId
  )}&api_key=${key}&file_type=json&sort_order=asc&limit=${limit}`;

  const json = await getJSON<{ observations: FredObservation[] }>(url).catch(() => null);
  if (!json?.observations) return null;

  return json.observations
    .filter((obs) => obs.value !== ".")
    .map((obs) => ({
      t: obs.date,
      v: Number(obs.value)
    }));
}
