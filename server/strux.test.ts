import { describe, it, expect } from 'vitest';
import {
  initDb,
  getAllBlueprints,
  getBlueprintById,
  createBlueprint,
  getRecords,
  createRecord,
  createRecordsBatch,
  updateRecord,
  deleteRecord,
  getSavedPrompts
} from './db.ts';
import {
  PROMPT_A_SCHEMA_ARCHITECT,
  PROMPT_B_DATA_EXTRACTOR,
  designOrRefineSchema,
  extractStructuredData,
  executeContextStudioQuery,
  convertBlueprintSchemaToGeminiSchema
} from './gemini.ts';
import {
  buildChatbotSchemaArchitectPrompt,
  buildChatbotDataExtractionPrompt,
  extractJsonFromClipboardText,
  normalizeParsedChatbotSchema
} from '../src/utils/clipboardBridge.ts';

describe('Strux Core Lifecycle & SRD Verification', () => {
  initDb();

  it('embeds exact System Prompts A & B from SRD Section 5', () => {
    expect(PROMPT_A_SCHEMA_ARCHITECT).toContain('You are the Strux Schema Architect.');
    expect(PROMPT_A_SCHEMA_ARCHITECT).toContain(
      'Every property must include a clear description attribute, because those descriptions will later act as instructions for an LLM extractor.'
    );
    expect(PROMPT_B_DATA_EXTRACTOR).toContain('You are the Strux Data Ingestion Engine.');
    expect(PROMPT_B_DATA_EXTRACTOR).toContain(
      'Do not invent facts not present or implied in the source text; if a non-required field is missing, omit it or set it to null.'
    );
  });

  it('seeds initial Blueprints, Records, and Saved_Prompts in SQLite', () => {
    const bps = getAllBlueprints();
    expect(bps.length).toBeGreaterThanOrEqual(3);

    const rpgBp = getBlueprintById('bp-ttrpg-encounters');
    expect(rpgBp).not.toBeNull();
    expect(rpgBp?.json_schema.required).toContain('title');

    const geminiSchema = convertBlueprintSchemaToGeminiSchema(rpgBp!.json_schema);
    expect(geminiSchema.properties).toBeDefined();

    const recs = getRecords('bp-ttrpg-encounters');
    expect(recs.length).toBeGreaterThanOrEqual(3);

    const prompts = getSavedPrompts();
    expect(prompts.length).toBeGreaterThanOrEqual(3);
  });

  it('executes Module 1 (Schema Architect) and creates a new Blueprint', async () => {
    const designed = await designOrRefineSchema({
      prompt: 'Track engineering tasks with priority enum, owner, and acceptance criteria array'
    });
    expect(designed.json_schema.type).toBe('object');
    expect(Object.keys(designed.json_schema.properties).length).toBeGreaterThan(2);

    const saved = createBlueprint({
      name: designed.name,
      description: designed.description,
      json_schema: designed.json_schema,
      extraction_prompt_template: designed.extraction_prompt_template,
      ui_config: designed.ui_config
    });
    expect(saved.id).toBeTruthy();
  });

  it('executes Module 2 (Data Extractor) in Single and Batch modes', async () => {
    const rpgBp = getBlueprintById('bp-ttrpg-encounters')!;
    const singleRes = await extractStructuredData({
      blueprint: rpgBp,
      rawText: 'Vault of Shadows at Upper Spire. High intensity Stealth & Heist.\n- Clue 1: Silver key\n- Clue 2: Encrypted map',
      mode: 'single'
    });
    expect(singleRes.items.length).toBe(1);
    expect(singleRes.items[0].title).toBeTruthy();

    const batchRes = await extractStructuredData({
      blueprint: rpgBp,
      rawText: 'Encounter Alpha at Dock 4\n- Clue A\n\n---\n\nEncounter Beta at Citadel\n- Clue B',
      mode: 'batch'
    });
    expect(batchRes.items.length).toBe(2);
  });

  it('executes Module 3 (Collection CRUD) and Module 4 (Context Studio + Round-Trip Generation)', async () => {
    const rpgBp = getBlueprintById('bp-ttrpg-encounters')!;
    const rec = createRecord(
      rpgBp.id,
      {
        title: 'Test Encounter',
        location: 'Test Sanctum',
        intensity_level: 'High',
        encounter_type: 'Investigation',
        motive: 'Test motive',
        clues: ['Clue 1']
      },
      'Raw source note'
    );
    expect(rec.id).toBeTruthy();

    const updated = updateRecord(rec.id, { ...rec.data, intensity_level: 'Deadly' });
    expect(updated?.data.intensity_level).toBe('Deadly');

    const contextRes = await executeContextStudioQuery({
      systemInstruction: 'Synthesize RPG context',
      userQuery: 'Generate a sequel encounter',
      contextRecords: [{ id: rec.id, blueprintName: rpgBp.name, data: updated!.data }],
      targetBlueprintForGeneration: rpgBp
    });
    expect(contextRes.generatedObject).toBeTruthy();
    expect(contextRes.estimatedTokens).toBeGreaterThan(10);

    const deleted = deleteRecord(rec.id);
    expect(deleted).toBe(true);
  });

  it('generates tailored chatbot prompts and parses fenced JSON responses from clipboard', () => {
    const rpgBp = getBlueprintById('bp-ttrpg-encounters')!;

    // 1. Schema Architect prompt & clipboard parser
    const archPrompt = buildChatbotSchemaArchitectPrompt({
      userInput: 'Track sci-fi starships with hull class, crew count, and weapons array'
    });
    expect(archPrompt).toContain(PROMPT_A_SCHEMA_ARCHITECT);
    expect(archPrompt).toContain('STRICT OUTPUT FORMAT INSTRUCTIONS');

    const simulatedChatbotSchemaReply = `Sure! Here is your JSON schema:\n\`\`\`json\n{
      "name": "Starship Fleet Registry",
      "description": "Tracks starships and weapons",
      "icon": "Cpu",
      "extraction_prompt_template": "Keep specs accurate",
      "fields": [
        { "field_name": "ship_name", "type": "string", "description": "Vessel name", "required": true },
        { "field_name": "hull_class", "type": "string", "description": "Class", "required": true, "enum_values": ["Frigate", "Cruiser", "Dreadnought"] }
      ]
    }\n\`\`\`\nLet me know if you need adjustments!`;

    const parsedSchemaObj = extractJsonFromClipboardText(simulatedChatbotSchemaReply);
    const normalized = normalizeParsedChatbotSchema(parsedSchemaObj);
    expect(normalized.name).toBe('Starship Fleet Registry');
    expect(normalized.json_schema.properties.hull_class.enum).toEqual([
      'Frigate',
      'Cruiser',
      'Dreadnought'
    ]);

    // 2. Data Extraction prompt & clipboard parser
    const extractPrompt = buildChatbotDataExtractionPrompt({
      blueprint: rpgBp,
      rawText: 'The Sunken Crypt at Old Harbor. Deadly combat.',
      mode: 'single'
    });
    expect(extractPrompt).toContain(PROMPT_B_DATA_EXTRACTOR);
    expect(extractPrompt).toContain('TTRPG Encounters & Intrigue');

    const simulatedChatbotExtractionReply = `Here is the extracted JSON:\n\`\`\`json\n[
      {
        "title": "The Sunken Crypt",
        "location": "Old Harbor",
        "intensity_level": "Deadly",
        "encounter_type": "Tactical Combat",
        "motive": "Guard the relic",
        "clues": ["Ancient rune"]
      }
    ]\n\`\`\``;
    const extracted = extractJsonFromClipboardText(simulatedChatbotExtractionReply);
    expect(Array.isArray(extracted)).toBe(true);
    expect(extracted[0].title).toBe('The Sunken Crypt');
  });

  it('merges and updates existing records by Master Key in createRecordsBatch', () => {
    const rpgBp = getBlueprintById('bp-ttrpg-encounters')!;

    // 1. Insert initial record via batch
    const firstBatch = createRecordsBatch(rpgBp.id, [
      {
        data: {
          title: 'The Crimson Relay',
          location: 'Orbital Station 7',
          intensity_level: 'Medium',
          encounter_type: 'Investigation',
          motive: 'Intercept transmission',
          clues: ['Encrypted data pad']
        },
        raw_source: 'Initial notes',
        strategy: 'merge'
      }
    ]);
    expect(firstBatch.insertedCount).toBe(1);
    expect(firstBatch.mergedCount).toBe(0);
    const createdId = firstBatch.records[0].id;

    // 2. Batch import an update with the same Master Key ('title': 'the crimson relay' case-insensitive)
    const secondBatch = createRecordsBatch(rpgBp.id, [
      {
        data: {
          title: '  the crimson relay ',
          intensity_level: 'Deadly',
          clues: ['Voice log fragment']
        },
        raw_source: 'Updated session notes',
        strategy: 'merge'
      }
    ]);
    expect(secondBatch.insertedCount).toBe(0);
    expect(secondBatch.mergedCount).toBe(1);
    expect(secondBatch.records[0].id).toBe(createdId);
    // Preserved existing field (location) + updated field (intensity_level) + merged array (clues)
    expect(secondBatch.records[0].data.location).toBe('Orbital Station 7');
    expect(secondBatch.records[0].data.intensity_level).toBe('Deadly');
    expect(secondBatch.records[0].data.clues).toEqual([
      'Encrypted data pad',
      'Voice log fragment'
    ]);

    // Cleanup test record
    deleteRecord(createdId);
  });
});


