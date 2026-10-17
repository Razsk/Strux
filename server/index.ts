import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import Ajv from 'ajv';
import {
  initDb,
  getAllBlueprints,
  getBlueprintById,
  createBlueprint,
  updateBlueprint,
  deleteBlueprint,
  getRecords,
  getRecordById,
  createRecord,
  createRecordsBatch,
  updateRecord,
  deleteRecord,
  deleteRecordsBatch,
  getSavedPrompts,
  createSavedPrompt,
  deleteSavedPrompt,
  setSetting
} from './db.ts';
import {
  resolveApiKey,
  designOrRefineSchema,
  extractStructuredData,
  executeContextStudioQuery,
  PROMPT_A_SCHEMA_ARCHITECT,
  PROMPT_B_DATA_EXTRACTOR
} from './gemini.ts';

initDb();

export const app = express();
const ajv = new Ajv({ allErrors: true, strict: false });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health & System Configuration
app.get('/api/status', (req, res) => {
  const headerKey = req.header('x-gemini-api-key');
  const key = resolveApiKey(headerKey);
  res.json({
    status: 'ok',
    hasApiKey: Boolean(key),
    model: 'gemini-3.8-flash',
    systemPrompts: {
      schemaArchitect: PROMPT_A_SCHEMA_ARCHITECT,
      dataExtractor: PROMPT_B_DATA_EXTRACTOR
    }
  });
});

app.post('/api/settings/api-key', (req, res) => {
  const { apiKey } = req.body || {};
  if (typeof apiKey !== 'string') {
    res.status(400).json({ error: 'apiKey string is required' });
    return;
  }
  setSetting('GEMINI_API_KEY', apiKey.trim());
  res.json({ success: true, hasApiKey: Boolean(apiKey.trim()) });
});

// Blueprints CRUD
app.get('/api/blueprints', (_req, res) => {
  res.json(getAllBlueprints());
});

app.get('/api/blueprints/:id', (req, res) => {
  const bp = getBlueprintById(req.params.id);
  if (!bp) {
    res.status(404).json({ error: 'Blueprint not found' });
    return;
  }
  res.json(bp);
});

app.post('/api/blueprints', (req, res) => {
  try {
    const { name, description, json_schema, extraction_prompt_template, ui_config } = req.body;
    if (!name || !json_schema) {
      res.status(400).json({ error: 'name and json_schema are required' });
      return;
    }
    const created = createBlueprint({
      name,
      description: description || '',
      json_schema,
      extraction_prompt_template: extraction_prompt_template || '',
      ui_config: ui_config || {
        icon: 'Sparkles',
        version: '1.0.0',
        primaryField: Object.keys(json_schema.properties || {})[0] || 'title',
        badgeFields: []
      }
    });
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create blueprint' });
  }
});

app.put('/api/blueprints/:id', (req, res) => {
  try {
    const updated = updateBlueprint(req.params.id, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Blueprint not found' });
      return;
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update blueprint' });
  }
});

app.delete('/api/blueprints/:id', (req, res) => {
  const deleted = deleteBlueprint(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Blueprint not found' });
    return;
  }
  res.json({ success: true });
});

// Module 1: Schema Architect (AI Meta-Prompting)
app.post('/api/architect/design', async (req, res) => {
  try {
    const { prompt, currentBlueprint } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }
    const apiKey = resolveApiKey(req.header('x-gemini-api-key'));
    const result = await designOrRefineSchema({ prompt, currentBlueprint, apiKey });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Schema generation failed' });
  }
});

// Module 2: Data Extractor (Unstructured -> Validated JSON)
app.post('/api/extract', async (req, res) => {
  try {
    const { blueprint_id, raw_text, mode = 'single', custom_instructions } = req.body || {};
    if (!blueprint_id || !raw_text) {
      res.status(400).json({ error: 'blueprint_id and raw_text are required' });
      return;
    }
    const blueprint = getBlueprintById(blueprint_id);
    if (!blueprint) {
      res.status(404).json({ error: 'Blueprint not found' });
      return;
    }

    const apiKey = resolveApiKey(req.header('x-gemini-api-key'));
    const extraction = await extractStructuredData({
      blueprint,
      rawText: raw_text,
      mode: mode === 'batch' ? 'batch' : 'single',
      customInstructions: custom_instructions,
      apiKey
    });

    const validate = ajv.compile(blueprint.json_schema);
    const stagedItems = extraction.items.map((item) => {
      const valid = Boolean(validate(item));
      const errors = (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`);
      return {
        data: item,
        raw_source: raw_text,
        isValid: valid,
        validationErrors: errors
      };
    });

    res.json({
      items: stagedItems,
      simulated: extraction.simulated,
      promptUsed: extraction.promptUsed
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Data extraction failed' });
  }
});

// Module 3: Records CRUD & Validation
app.get('/api/records', (req, res) => {
  const blueprintId = typeof req.query.blueprint_id === 'string' ? req.query.blueprint_id : undefined;
  res.json(getRecords(blueprintId));
});

app.post('/api/records', (req, res) => {
  try {
    const { blueprint_id, data, raw_source, items } = req.body || {};
    if (!blueprint_id) {
      res.status(400).json({ error: 'blueprint_id is required' });
      return;
    }
    const blueprint = getBlueprintById(blueprint_id);
    if (!blueprint) {
      res.status(404).json({ error: 'Blueprint not found' });
      return;
    }

    if (Array.isArray(items)) {
      const created = createRecordsBatch(blueprint_id, items);
      res.status(201).json(created);
      return;
    }

    if (!data || typeof data !== 'object') {
      res.status(400).json({ error: 'data object or items array is required' });
      return;
    }

    const created = createRecord(blueprint_id, data, raw_source);
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to save record(s)' });
  }
});

app.put('/api/records/:id', (req, res) => {
  try {
    const { data, raw_source } = req.body || {};
    if (!data || typeof data !== 'object') {
      res.status(400).json({ error: 'data object is required' });
      return;
    }
    const updated = updateRecord(req.params.id, data, raw_source);
    if (!updated) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update record' });
  }
});

app.delete('/api/records/:id', (req, res) => {
  const ok = deleteRecord(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }
  res.json({ success: true });
});

app.post('/api/records/bulk-delete', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) {
    res.status(400).json({ error: 'ids array is required' });
    return;
  }
  const deletedCount = deleteRecordsBatch(ids);
  res.json({ success: true, deletedCount });
});

app.post('/api/validate', (req, res) => {
  try {
    const { blueprint_id, data } = req.body || {};
    const blueprint = getBlueprintById(blueprint_id);
    if (!blueprint) {
      res.status(404).json({ error: 'Blueprint not found' });
      return;
    }
    const validate = ajv.compile(blueprint.json_schema);
    const isValid = Boolean(validate(data));
    const validationErrors = (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`);
    res.json({ isValid, validationErrors });
  } catch (err: any) {
    res.status(400).json({ isValid: false, validationErrors: [err.message] });
  }
});

// Module 4: Context Studio & Saved Prompts
app.get('/api/saved-prompts', (_req, res) => {
  res.json(getSavedPrompts());
});

app.post('/api/saved-prompts', (req, res) => {
  const { name, system_instruction, default_blueprint_ids } = req.body || {};
  if (!name || !system_instruction) {
    res.status(400).json({ error: 'name and system_instruction are required' });
    return;
  }
  const created = createSavedPrompt({
    name,
    system_instruction,
    default_blueprint_ids: Array.isArray(default_blueprint_ids) ? default_blueprint_ids : []
  });
  res.status(201).json(created);
});

app.delete('/api/saved-prompts/:id', (req, res) => {
  const ok = deleteSavedPrompt(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Saved prompt not found' });
    return;
  }
  res.json({ success: true });
});

app.post('/api/context/query', async (req, res) => {
  try {
    const {
      system_instruction,
      user_query,
      record_ids = [],
      target_blueprint_id
    } = req.body || {};

    if (!user_query || typeof user_query !== 'string') {
      res.status(400).json({ error: 'user_query is required' });
      return;
    }

    const blueprintsMap = new Map(getAllBlueprints().map((b) => [b.id, b]));
    const contextRecords = (Array.isArray(record_ids) ? record_ids : [])
      .map((id: string) => getRecordById(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => ({
        id: r.id,
        blueprintName: blueprintsMap.get(r.blueprint_id)?.name || 'Collection',
        data: r.data
      }));

    const targetBlueprintForGeneration = target_blueprint_id
      ? getBlueprintById(target_blueprint_id)
      : null;

    const apiKey = resolveApiKey(req.header('x-gemini-api-key'));
    const result = await executeContextStudioQuery({
      systemInstruction: system_instruction || '',
      userQuery: user_query,
      contextRecords,
      targetBlueprintForGeneration,
      apiKey
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Context Studio query failed' });
  }
});

// Serve static frontend in production
const distPath = path.join(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

const PORT = Number(process.env.PORT) || 3001;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Strux API Server listening on http://localhost:${PORT}`);
  });
}
