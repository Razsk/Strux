import type { Blueprint, SavedPrompt, StruxRecord } from './types';

function getHeaders(): HeadersInit {
  const localKey = localStorage.getItem('STRUX_GEMINI_API_KEY') || '';
  return {
    'Content-Type': 'application/json',
    ...(localKey ? { 'x-gemini-api-key': localKey } : {})
  };
}

async function handleRes<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  getStatus: () =>
    fetch('/api/status', { headers: getHeaders() }).then((r) =>
      handleRes<{
        status: string;
        hasApiKey: boolean;
        model: string;
        systemPrompts: { schemaArchitect: string; dataExtractor: string };
      }>(r)
    ),

  saveApiKey: (apiKey: string) => {
    localStorage.setItem('STRUX_GEMINI_API_KEY', apiKey.trim());
    return fetch('/api/settings/api-key', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ apiKey })
    }).then((r) => handleRes<{ success: boolean; hasApiKey: boolean }>(r));
  },

  getBlueprints: () =>
    fetch('/api/blueprints', { headers: getHeaders() }).then((r) => handleRes<Blueprint[]>(r)),

  createBlueprint: (payload: Partial<Blueprint>) =>
    fetch('/api/blueprints', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    }).then((r) => handleRes<Blueprint>(r)),

  updateBlueprint: (id: string, payload: Partial<Blueprint>) =>
    fetch(`/api/blueprints/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    }).then((r) => handleRes<Blueprint>(r)),

  deleteBlueprint: (id: string) =>
    fetch(`/api/blueprints/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then((r) => handleRes<{ success: boolean }>(r)),

  designSchema: (prompt: string, currentBlueprint?: Partial<Blueprint>) =>
    fetch('/api/architect/design', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ prompt, currentBlueprint })
    }).then((r) =>
      handleRes<{
        name: string;
        description: string;
        extraction_prompt_template: string;
        json_schema: Blueprint['json_schema'];
        ui_config: Blueprint['ui_config'];
        simulated?: boolean;
      }>(r)
    ),

  extractData: (params: {
    blueprint_id: string;
    raw_text: string;
    mode: 'single' | 'batch';
    custom_instructions?: string;
  }) =>
    fetch('/api/extract', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(params)
    }).then((r) =>
      handleRes<{
        items: Array<{
          data: Record<string, any>;
          raw_source: string;
          isValid: boolean;
          validationErrors: string[];
        }>;
        simulated: boolean;
        promptUsed: string;
      }>(r)
    ),

  getRecords: (blueprintId?: string) =>
    fetch(`/api/records${blueprintId ? `?blueprint_id=${encodeURIComponent(blueprintId)}` : ''}`, {
      headers: getHeaders()
    }).then((r) => handleRes<StruxRecord[]>(r)),

  createRecord: (blueprint_id: string, data: Record<string, any>, raw_source?: string | null) =>
    fetch('/api/records', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ blueprint_id, data, raw_source })
    }).then((r) => handleRes<StruxRecord>(r)),

  createRecordsBatch: (
    blueprint_id: string,
    items: Array<{ data: Record<string, any>; raw_source?: string | null }>
  ) =>
    fetch('/api/records', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ blueprint_id, items })
    }).then((r) => handleRes<StruxRecord[]>(r)),

  updateRecord: (id: string, data: Record<string, any>, raw_source?: string | null) =>
    fetch(`/api/records/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ data, raw_source })
    }).then((r) => handleRes<StruxRecord>(r)),

  deleteRecord: (id: string) =>
    fetch(`/api/records/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then((r) => handleRes<{ success: boolean }>(r)),

  bulkDeleteRecords: (ids: string[]) =>
    fetch('/api/records/bulk-delete', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ ids })
    }).then((r) => handleRes<{ success: boolean; deletedCount: number }>(r)),

  validateRecord: (blueprint_id: string, data: Record<string, any>) =>
    fetch('/api/validate', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ blueprint_id, data })
    }).then((r) => handleRes<{ isValid: boolean; validationErrors: string[] }>(r)),

  getSavedPrompts: () =>
    fetch('/api/saved-prompts', { headers: getHeaders() }).then((r) => handleRes<SavedPrompt[]>(r)),

  createSavedPrompt: (payload: Omit<SavedPrompt, 'id' | 'created_at'>) =>
    fetch('/api/saved-prompts', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    }).then((r) => handleRes<SavedPrompt>(r)),

  deleteSavedPrompt: (id: string) =>
    fetch(`/api/saved-prompts/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then((r) => handleRes<{ success: boolean }>(r)),

  queryContextStudio: (params: {
    system_instruction: string;
    user_query: string;
    record_ids: string[];
    target_blueprint_id?: string | null;
  }) =>
    fetch('/api/context/query', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(params)
    }).then((r) =>
      handleRes<{
        answer: string;
        generatedObject?: Record<string, any> | null;
        simulated: boolean;
        estimatedTokens: number;
      }>(r)
    )
};
