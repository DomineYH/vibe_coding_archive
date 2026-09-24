import type { components } from "../contracts/api.d.ts";

export type MetaResponse = components["schemas"]["MetaResponse"];

export const mockMeta: MetaResponse = {
  subjects: ["수학", "과학", "영어"],
  grades: ["초1", "초2", "초3"],
  themes: ["sage", "ocean", "sunset"],
  capabilities: {
    healthCheck: true,
  },
};

export async function fetchMeta(): Promise<MetaResponse> {
  return Promise.resolve(mockMeta);
}
