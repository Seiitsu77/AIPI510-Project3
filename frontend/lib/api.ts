import type {
  HistoricalReference,
  ModelInfo,
  Prediction,
  Race,
  Replay,
} from "./types";
const API = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
).replace(/\/$/, "");
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      signal: init?.signal || controller.signal,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : `API returned ${res.status}`,
      );
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error(
        "The API request timed out. Check the backend connection.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
export const getRaces = () => request<Race[]>("/races");
export const getReplay = (key: number) =>
  request<Replay>(`/races/${key}/replay`);
export const getReference = (params: {
  circuit: string;
  driver: string;
  team: string;
  compound: string;
}) =>
  request<HistoricalReference>(
    `/reference?${new URLSearchParams(params).toString()}`,
  );
export async function getModel(): Promise<ModelInfo> {
  try {
    return await request<ModelInfo>("/model/info");
  } catch (error) {
    return {
      available: false,
      detail: error instanceof Error ? error.message : "Model unavailable",
    };
  }
}
export type Parameters = {
  circuit: string;
  driver: string;
  team: string;
  compound: string;
  tyre_age: number;
  race_lap: number;
  track_temperature: number;
  rainfall: number;
};
export const estimate = (params: Parameters) =>
  request<Prediction>("/predict", {
    method: "POST",
    body: JSON.stringify(params),
  });
export const estimateBatch = (items: Parameters[]) =>
  request<{ predictions: Prediction[] }>("/predict/batch", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
