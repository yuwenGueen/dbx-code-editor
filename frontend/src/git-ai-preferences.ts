export interface GitAiPreferences { provider: string; models: Record<string, string> }
export function readGitAiPreferences(value: unknown): GitAiPreferences {
 const result: GitAiPreferences = { provider: "", models: Object.create(null) };
 if (!value || typeof value !== "object") return result;
 const saved = value as Partial<GitAiPreferences>;
 if (typeof saved.provider === "string" && saved.provider.length <= 256) result.provider = saved.provider;
 if (saved.models && typeof saved.models === "object") for (const [id, model] of Object.entries(saved.models)) {
  if (id.length <= 256 && typeof model === "string" && model.length <= 256) result.models[id] = model;
 }
 return result;
}
