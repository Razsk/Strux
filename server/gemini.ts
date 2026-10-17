import { GoogleGenAI, Type, type Schema } from '@google/genai';
import { getSetting } from './db.ts';
import type { Blueprint, JsonSchemaDefinition, SchemaProperty } from '../src/types.ts';

// Exact System Prompts from SRD Section 5
export const PROMPT_A_SCHEMA_ARCHITECT =
  "You are the Strux Schema Architect. Your goal is to analyze the user's domain description or sample unstructured text and design an optimal, rigorous JSON Schema. Every property must include a clear description attribute, because those descriptions will later act as instructions for an LLM extractor. Favor clean, predictable data types (strings, arrays of strings, enums, booleans, numbers) and avoid overly deep nesting unless necessary.";

export const PROMPT_B_DATA_EXTRACTOR =
  "You are the Strux Data Ingestion Engine. Extract information from the provided unstructured text and map it strictly into the provided JSON Schema. Follow the instructions in each field's description. Do not invent facts not present or implied in the source text; if a non-required field is missing, omit it or set it to null. Output valid JSON matching the schema.";

export function resolveApiKey(headerKey?: string): string | null {
  if (headerKey && headerKey.trim()) return headerKey.trim();
  const dbKey = getSetting('GEMINI_API_KEY');
  if (dbKey && dbKey.trim()) return dbKey.trim();
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }
  if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY.trim()) {
    return process.env.GOOGLE_API_KEY.trim();
  }
  return null;
}

function mapTypeToGeminiType(typeStr: string): Type {
  switch (typeStr?.toLowerCase()) {
    case 'string':
      return Type.STRING;
    case 'number':
      return Type.NUMBER;
    case 'integer':
      return Type.INTEGER;
    case 'boolean':
      return Type.BOOLEAN;
    case 'array':
      return Type.ARRAY;
    case 'object':
      return Type.OBJECT;
    default:
      return Type.STRING;
  }
}

export function convertBlueprintSchemaToGeminiSchema(jsonSchema: JsonSchemaDefinition): Schema {
  const properties: Record<string, Schema> = {};

  for (const [key, prop] of Object.entries(jsonSchema.properties || {})) {
    properties[key] = convertPropertyToGeminiSchema(prop);
  }

  return {
    type: Type.OBJECT,
    properties,
    required: jsonSchema.required || []
  };
}

function convertPropertyToGeminiSchema(prop: SchemaProperty): Schema {
  const gType = mapTypeToGeminiType(prop.type);
  const schema: Schema = {
    type: gType,
    description: prop.description || ''
  };

  if (prop.enum && prop.enum.length > 0 && gType === Type.STRING) {
    schema.enum = prop.enum;
  }

  if (gType === Type.ARRAY) {
    const itemType = prop.items?.type ? mapTypeToGeminiType(prop.items.type) : Type.STRING;
    schema.items = {
      type: itemType,
      ...(prop.items?.enum && prop.items.enum.length > 0 ? { enum: prop.items.enum } : {})
    };
  }

  if (gType === Type.OBJECT && prop.properties) {
    const nestedProps: Record<string, Schema> = {};
    for (const [k, v] of Object.entries(prop.properties)) {
      nestedProps[k] = convertPropertyToGeminiSchema(v);
    }
    schema.properties = nestedProps;
  }

  return schema;
}

// Meta-schema used to enforce structured output from the Schema Architect
const ARCHITECT_META_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    name: {
      type: Type.STRING,
      description: 'Clean, concise display title for the Blueprint (e.g., "TTRPG Encounters & Intrigue").'
    },
    description: {
      type: Type.STRING,
      description: '1-2 sentence summary of the schema domain and what it tracks.'
    },
    icon: {
      type: Type.STRING,
      description: 'Suggested Lucide icon name.',
      enum: ['Swords', 'Server', 'BookOpen', 'CheckSquare', 'Users', 'Cpu', 'Database', 'Globe', 'Briefcase', 'FlaskConical', 'ShieldAlert', 'Sparkles']
    },
    extraction_prompt_template: {
      type: Type.STRING,
      description: 'Custom extraction rules for this blueprint (e.g., "Keep tone concise", "Normalize dates to ISO-8601").'
    },
    fields: {
      type: Type.ARRAY,
      description: 'List of schema properties designed for this domain.',
      items: {
        type: Type.OBJECT,
        properties: {
          field_name: {
            type: Type.STRING,
            description: 'snake_case property key name.'
          },
          type: {
            type: Type.STRING,
            description: 'JSON Schema data type.',
            enum: ['string', 'number', 'integer', 'boolean', 'array']
          },
          description: {
            type: Type.STRING,
            description: 'Clear extraction instruction describing what value belongs in this field.'
          },
          required: {
            type: Type.BOOLEAN,
            description: 'Whether this property is required on every extracted object.'
          },
          enum_values: {
            type: Type.ARRAY,
            description: 'Optional allowed enum values if type is string or array of strings. Leave empty if unconstrained.',
            items: { type: Type.STRING }
          }
        },
        required: ['field_name', 'type', 'description', 'required']
      }
    }
  },
  required: ['name', 'description', 'icon', 'extraction_prompt_template', 'fields']
};

export interface ArchitectResult {
  name: string;
  description: string;
  extraction_prompt_template: string;
  json_schema: JsonSchemaDefinition;
  ui_config: {
    icon: string;
    version: string;
    primaryField: string;
    subtitleField?: string;
    badgeFields: string[];
    colorAccent: string;
  };
  ai_note?: string;
  simulated?: boolean;
}

export async function designOrRefineSchema(params: {
  prompt: string;
  currentBlueprint?: Partial<Blueprint>;
  apiKey?: string | null;
}): Promise<ArchitectResult> {
  const { prompt, currentBlueprint, apiKey } = params;

  if (apiKey) {
    const ai = new GoogleGenAI({ apiKey });
    const userMessage = currentBlueprint?.json_schema
      ? `Current Blueprint State:\n${JSON.stringify(
          {
            name: currentBlueprint.name,
            description: currentBlueprint.description,
            json_schema: currentBlueprint.json_schema,
            extraction_prompt_template: currentBlueprint.extraction_prompt_template
          },
          null,
          2
        )}\n\nUser Refinement Request:\n${prompt}`
      : `User Domain Description or Sample Unstructured Text:\n${prompt}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: userMessage,
      config: {
        systemInstruction: PROMPT_A_SCHEMA_ARCHITECT,
        responseMimeType: 'application/json',
        responseSchema: ARCHITECT_META_RESPONSE_SCHEMA,
        temperature: 0.2
      }
    });

    const parsed = JSON.parse(response.text || '{}');
    return transformArchitectMetaToBlueprint(parsed, false);
  }

  // Intelligent deterministic fallback when no API key is configured yet
  return synthesizeLocalSchema(prompt, currentBlueprint);
}

function transformArchitectMetaToBlueprint(meta: any, simulated: boolean): ArchitectResult {
  const properties: Record<string, SchemaProperty> = {};
  const required: string[] = [];
  const badgeFields: string[] = [];
  let primaryField = '';
  let subtitleField = '';

  for (const field of meta.fields || []) {
    const key = (field.field_name || 'field')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');

    const hasEnums = Array.isArray(field.enum_values) && field.enum_values.length > 0;
    const prop: SchemaProperty = {
      type: field.type || 'string',
      description: field.description || `Extracted value for ${key}`
    };

    if (prop.type === 'array') {
      prop.items = {
        type: 'string',
        ...(hasEnums ? { enum: field.enum_values } : {})
      };
    } else if (hasEnums && prop.type === 'string') {
      prop.enum = field.enum_values;
      if (badgeFields.length < 2) badgeFields.push(key);
    }

    properties[key] = prop;
    if (field.required) required.push(key);

    if (!primaryField && prop.type === 'string' && !hasEnums) {
      primaryField = key;
    } else if (primaryField && !subtitleField && prop.type === 'string' && !hasEnums) {
      subtitleField = key;
    }
  }

  const allKeys = Object.keys(properties);
  if (!primaryField && allKeys.length > 0) primaryField = allKeys[0];

  return {
    name: meta.name || 'Custom Domain Blueprint',
    description: meta.description || 'Structured domain collection designed by Strux Schema Architect.',
    extraction_prompt_template:
      meta.extraction_prompt_template || 'Keep extracted fields concise, factual, and normalized.',
    json_schema: {
      type: 'object',
      properties,
      required
    },
    ui_config: {
      icon: meta.icon || 'Sparkles',
      version: '1.0.0',
      primaryField,
      subtitleField: subtitleField || undefined,
      badgeFields,
      colorAccent: 'indigo'
    },
    simulated
  };
}

function synthesizeLocalSchema(prompt: string, currentBlueprint?: Partial<Blueprint>): ArchitectResult {
  const lower = prompt.toLowerCase();

  // If refining an existing schema locally
  if (currentBlueprint?.json_schema) {
    const cloned: JsonSchemaDefinition = JSON.parse(JSON.stringify(currentBlueprint.json_schema));
    if (lower.includes('priority') || lower.includes('severity') || lower.includes('urgency')) {
      cloned.properties['priority_level'] = {
        type: 'string',
        description: 'Priority or urgency level inferred from context.',
        enum: ['Low', 'Medium', 'High', 'Critical']
      };
    } else if (lower.includes('date') || lower.includes('deadline') || lower.includes('timestamp')) {
      cloned.properties['target_date'] = {
        type: 'string',
        description: 'Relevant ISO-8601 date or timeline milestone.'
      };
    } else {
      const customKey =
        prompt
          .replace(/add|include|field|property|called|named|for/gi, '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')
          .slice(0, 24) || 'custom_attribute';
      cloned.properties[customKey] = {
        type: lower.includes('list') || lower.includes('array') ? 'array' : 'string',
        description: `Refined field based on instruction: "${prompt.trim()}"`,
        ...(lower.includes('list') || lower.includes('array') ? { items: { type: 'string' } } : {})
      };
    }
    const keys = Object.keys(cloned.properties);
    return {
      name: currentBlueprint.name || 'Refined Blueprint',
      description: currentBlueprint.description || 'Refined JSON Schema Blueprint.',
      extraction_prompt_template: currentBlueprint.extraction_prompt_template || 'Extract accurately.',
      json_schema: cloned,
      ui_config: {
        icon: currentBlueprint.ui_config?.icon || 'Sparkles',
        version: '1.1.0',
        primaryField: currentBlueprint.ui_config?.primaryField || keys[0] || 'title',
        subtitleField: currentBlueprint.ui_config?.subtitleField || keys[1],
        badgeFields: currentBlueprint.ui_config?.badgeFields || [],
        colorAccent: currentBlueprint.ui_config?.colorAccent || 'indigo'
      },
      simulated: true
    };
  }

  if (lower.includes('rpg') || lower.includes('encounter') || lower.includes('npc') || lower.includes('villain')) {
    return transformArchitectMetaToBlueprint(
      {
        name: 'TTRPG Encounters & Factions',
        description: 'Structured tabletop RPG encounters with motives, clues, relationship matrices, and intensity levels.',
        icon: 'Swords',
        extraction_prompt_template: 'Keep tone evocative and concise. Format relationship_matrix items as "Entity -> Attitude".',
        fields: [
          { field_name: 'title', type: 'string', description: 'Evocative name of the encounter or scene.', required: true },
          { field_name: 'location', type: 'string', description: 'District, dungeon room, or landmark.', required: true },
          { field_name: 'intensity_level', type: 'string', description: 'Threat and pacing intensity.', required: true, enum_values: ['Low', 'Moderate', 'High', 'Deadly'] },
          { field_name: 'encounter_type', type: 'string', description: 'Core encounter archetype.', required: true, enum_values: ['Social Intrigue', 'Investigation', 'Tactical Combat', 'Stealth & Heist', 'Exploration'] },
          { field_name: 'primary_antagonist_or_npc', type: 'string', description: 'Lead NPC or threat in the scene.', required: false },
          { field_name: 'motive', type: 'string', description: 'Core hidden agenda or objective driving the NPC.', required: true },
          { field_name: 'clues', type: 'array', description: 'Discoverable secrets, physical clues, or hooks.', required: true },
          { field_name: 'relationship_matrix', type: 'array', description: 'Faction and NPC relationships formatted as "Target -> Relation".', required: false }
        ]
      },
      true
    );
  }

  if (lower.includes('task') || lower.includes('bug') || lower.includes('ticket') || lower.includes('project') || lower.includes('action')) {
    return transformArchitectMetaToBlueprint(
      {
        name: 'Engineering Action Items & Bug Triage',
        description: 'Track actionable engineering tasks, owners, priority tiers, blockers, and acceptance criteria from meeting notes.',
        icon: 'CheckSquare',
        extraction_prompt_template: 'Extract concrete action items with clear verb-first summaries. Normalize owners and infer priority.',
        fields: [
          { field_name: 'task_title', type: 'string', description: 'Action-oriented summary of the task or bug.', required: true },
          { field_name: 'owner', type: 'string', description: 'Assigned engineer, squad, or stakeholder.', required: true },
          { field_name: 'priority', type: 'string', description: 'Urgency tier of the work item.', required: true, enum_values: ['P0 - Critical', 'P1 - High', 'P2 - Medium', 'P3 - Low'] },
          { field_name: 'status', type: 'string', description: 'Current workflow state.', required: true, enum_values: ['Backlog', 'In Progress', 'Blocked', 'Ready for Review'] },
          { field_name: 'component', type: 'string', description: 'System module, service, or frontend surface affected.', required: false },
          { field_name: 'acceptance_criteria', type: 'array', description: 'Specific conditions or steps required to complete the item.', required: true },
          { field_name: 'due_date', type: 'string', description: 'Target milestone or deadline mentioned.', required: false }
        ]
      },
      true
    );
  }

  return transformArchitectMetaToBlueprint(
    {
      name: 'Domain Knowledge Entities',
      description: `Structured schema tailored for: ${prompt.slice(0, 110)}`,
      icon: 'Sparkles',
      extraction_prompt_template: 'Extract factual attributes cleanly and preserve domain terminology.',
      fields: [
        { field_name: 'title', type: 'string', description: 'Primary name or identifier of the item.', required: true },
        { field_name: 'category', type: 'string', description: 'Primary classification or group.', required: true, enum_values: ['Core', 'Operations', 'Research', 'Reference'] },
        { field_name: 'status', type: 'string', description: 'Lifecycle or priority state.', required: true, enum_values: ['Active', 'Draft', 'Archived', 'High Priority'] },
        { field_name: 'summary', type: 'string', description: 'Concise 1-2 sentence synthesis of the item.', required: true },
        { field_name: 'key_points', type: 'array', description: 'Extracted bullet points, attributes, or evidence.', required: true },
        { field_name: 'source_reference', type: 'string', description: 'Originating stakeholder, document, or context.', required: false }
      ]
    },
    true
  );
}

export async function extractStructuredData(params: {
  blueprint: Blueprint;
  rawText: string;
  mode: 'single' | 'batch';
  customInstructions?: string;
  apiKey?: string | null;
}): Promise<{ items: Record<string, any>[]; simulated: boolean; promptUsed: string }> {
  const { blueprint, rawText, mode, customInstructions, apiKey } = params;

  const fieldDescriptions = Object.entries(blueprint.json_schema.properties || {})
    .map(([key, prop]) => {
      const req = blueprint.json_schema.required?.includes(key) ? ' (REQUIRED)' : ' (optional)';
      const enums = prop.enum ? ` [Allowed values: ${prop.enum.join(', ')}]` : '';
      return `- ${key} (${prop.type})${req}${enums}: ${prop.description}`;
    })
    .join('\n');

  const combinedRules = [blueprint.extraction_prompt_template, customInstructions]
    .filter(Boolean)
    .join('\n');

  const dynamicPrompt = [
    `Blueprint Target: ${blueprint.name} (${blueprint.description})`,
    `Extraction Mode: ${mode === 'batch' ? 'Batch Extraction (Extract ALL distinct items found in the text as a JSON Array)' : 'Single Object Extraction (Synthesize into 1 JSON object)'}`,
    `\nSchema Field Instructions:\n${fieldDescriptions}`,
    combinedRules ? `\nCustom Extraction Rules:\n${combinedRules}` : '',
    `\n--- RAW UNSTRUCTURED INPUT ---\n${rawText}`
  ]
    .filter(Boolean)
    .join('\n');

  if (apiKey) {
    const ai = new GoogleGenAI({ apiKey });
    const singleSchema = convertBlueprintSchemaToGeminiSchema(blueprint.json_schema);
    const responseSchema: Schema =
      mode === 'batch'
        ? {
            type: Type.ARRAY,
            description: `Array of extracted ${blueprint.name} objects matching the schema.`,
            items: singleSchema
          }
        : singleSchema;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: dynamicPrompt,
      config: {
        systemInstruction: PROMPT_B_DATA_EXTRACTOR,
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.1
      }
    });

    const parsed = JSON.parse(response.text || (mode === 'batch' ? '[]' : '{}'));
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return { items, simulated: false, promptUsed: dynamicPrompt };
  }

  // Intelligent deterministic local parser fallback so the user can test extraction immediately even before adding a Gemini API key
  const simulatedItems = simulateExtractionLocally(blueprint, rawText, mode);
  return { items: simulatedItems, simulated: true, promptUsed: dynamicPrompt };
}

function simulateExtractionLocally(
  blueprint: Blueprint,
  rawText: string,
  mode: 'single' | 'batch'
): Record<string, any>[] {
  const chunks =
    mode === 'batch'
      ? rawText
          .split(/\n\s*(?:---+|\*\*\*+|===+|\n\n(?=[A-Z0-9#*-]))\s*\n/)
          .map((c) => c.trim())
          .filter((c) => c.length > 20)
      : [rawText.trim()];

  const effectiveChunks = chunks.length > 0 ? chunks : [rawText.trim()];

  return effectiveChunks.map((chunk, idx) => {
    const lines = chunk
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const firstLine = (lines[0] || `Extracted ${blueprint.name} #${idx + 1}`).replace(/^[#*-]+\s*/, '');
    const bulletLines = lines
      .slice(1)
      .filter((l) => /^[-*•\d.]/.test(l))
      .map((l) => l.replace(/^[-*•\d.)]+\s*/, '').trim());

    const obj: Record<string, any> = {};
    const props = blueprint.json_schema.properties || {};

    for (const [key, prop] of Object.entries(props)) {
      const kLower = key.toLowerCase();
      if (prop.enum && prop.enum.length > 0) {
        const matchedEnum = prop.enum.find((val) => chunk.toLowerCase().includes(val.toLowerCase()));
        obj[key] = matchedEnum || prop.enum[0];
      } else if (prop.type === 'string') {
        if (key === blueprint.ui_config?.primaryField || kLower.includes('title') || kLower.includes('name') || kLower.includes('host')) {
          obj[key] = firstLine.slice(0, 90);
        } else if (kLower.includes('location') || kLower.includes('region') || kLower.includes('source')) {
          const locMatch = chunk.match(/(?:at|in|from|location:|region:|source:)\s+([A-Z][A-Za-z0-9\s—-]{3,40})/i);
          obj[key] = locMatch ? locMatch[1].trim() : lines[1]?.slice(0, 60) || 'Extracted Context';
        } else if (kLower.includes('ip')) {
          const ipMatch = chunk.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
          obj[key] = ipMatch ? ipMatch[0] : '10.24.16.10';
        } else {
          obj[key] = lines.slice(1).join(' ').slice(0, 220) || firstLine;
        }
      } else if (prop.type === 'integer' || prop.type === 'number') {
        const numMatch = chunk.match(new RegExp(`(\\d+)\\s*(?:${kLower.replace('_', '|')}|gb|cores|cpu|ram)`, 'i')) || chunk.match(/\b(\d+)\b/);
        obj[key] = numMatch ? Number(numMatch[1]) : prop.type === 'integer' ? 16 : 64;
      } else if (prop.type === 'boolean') {
        obj[key] = /true|yes|active|enabled|healthy/i.test(chunk);
      } else if (prop.type === 'array') {
        if (bulletLines.length > 0) {
          obj[key] = bulletLines.slice(0, 5);
        } else {
          const sentences = chunk
            .split(/[.!?]+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 10);
          obj[key] = sentences.length > 1 ? sentences.slice(1, 4) : [firstLine];
        }
      }
    }

    return obj;
  });
}

export async function executeContextStudioQuery(params: {
  systemInstruction: string;
  userQuery: string;
  contextRecords: Array<{
    id: string;
    blueprintName: string;
    data: Record<string, any>;
  }>;
  targetBlueprintForGeneration?: Blueprint | null;
  apiKey?: string | null;
}): Promise<{
  answer: string;
  generatedObject?: Record<string, any> | null;
  simulated: boolean;
  estimatedTokens: number;
}> {
  const { systemInstruction, userQuery, contextRecords, targetBlueprintForGeneration, apiKey } = params;

  const contextJsonBlock = JSON.stringify(
    contextRecords.map((r) => ({
      _record_id: r.id,
      _collection: r.blueprintName,
      ...r.data
    })),
    null,
    2
  );

  const fullSystemPrompt = `${systemInstruction || 'You are the Strux Context Studio AI assistant.'}

You are grounded strictly in the following structured JSON collection context payload (${contextRecords.length} selected objects):
\`\`\`json
${contextJsonBlock}
\`\`\``;

  const estimatedTokens = Math.ceil((fullSystemPrompt.length + userQuery.length) / 4);

  if (apiKey) {
    const ai = new GoogleGenAI({ apiKey });

    if (targetBlueprintForGeneration) {
      const singleSchema = convertBlueprintSchemaToGeminiSchema(targetBlueprintForGeneration.json_schema);
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `${userQuery}\n\nGenerate a new valid JSON item strictly conforming to the "${targetBlueprintForGeneration.name}" schema, grounded in the context payload above.`,
        config: {
          systemInstruction: fullSystemPrompt,
          responseMimeType: 'application/json',
          responseSchema: singleSchema,
          temperature: 0.4
        }
      });

      const generatedObject = JSON.parse(response.text || '{}');
      return {
        answer: `Generated a new structured **${targetBlueprintForGeneration.name}** item grounded in ${contextRecords.length} context records. Review the payload below and click **Save to Collection** to commit it directly to your database.`,
        generatedObject,
        simulated: false,
        estimatedTokens
      };
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: userQuery,
      config: {
        systemInstruction: fullSystemPrompt,
        temperature: 0.3
      }
    });

    return {
      answer: response.text || 'No response returned.',
      generatedObject: null,
      simulated: false,
      estimatedTokens
    };
  }

  // Deterministic local synthesis & round-trip object generator when running without an API key
  if (targetBlueprintForGeneration) {
    const sampleGen = buildSynthesizedRecord(targetBlueprintForGeneration, contextRecords, userQuery);
    return {
      answer: `*(Demo Synthesis Mode — Add a Gemini API Key in Settings for live \`gemini-2.5-flash\` execution)*\n\nSynthesized a new **${targetBlueprintForGeneration.name}** object derived from **${contextRecords.length}** active context record(s). Use the **Save to Collection** button to persist it directly into **${targetBlueprintForGeneration.name}**.`,
      generatedObject: sampleGen,
      simulated: true,
      estimatedTokens
    };
  }

  const titles = contextRecords.map((r) => {
    const firstVal = Object.values(r.data)[0];
    return typeof firstVal === 'string' ? `"${firstVal}" (${r.blueprintName})` : r.blueprintName;
  });

  const synthesizedAnswer = [
    `### Grounded Context Analysis (${contextRecords.length} Structured Records)`,
    `> *Running in local synthesis mode. Configure your \`GEMINI_API_KEY\` in the top-right Settings dialog to run live \`gemini-2.5-flash\` inference.*`,
    '',
    `**Active Context Sources:** ${titles.join(', ') || 'None selected'}`,
    '',
    `**Synthesis for query:** *"${userQuery}"*`,
    ...contextRecords.slice(0, 5).map((rec, i) => {
      const entries = Object.entries(rec.data)
        .slice(0, 4)
        .map(([k, v]) => `\`${k}\`: ${Array.isArray(v) ? v.join('; ') : String(v)}`)
        .join(' — ');
      return `${i + 1}. **[${rec.blueprintName}]** ${entries}`;
    }),
    '',
    `Tip: Enable **Round-Trip Structured Generation** in the prompt bar and pick a target Blueprint to generate a schema-validated JSON record that you can save back to your collection in one click.`
  ].join('\n');

  return {
    answer: synthesizedAnswer,
    generatedObject: null,
    simulated: true,
    estimatedTokens
  };
}

function buildSynthesizedRecord(
  blueprint: Blueprint,
  contextRecords: Array<{ id: string; blueprintName: string; data: Record<string, any> }>,
  userQuery: string
): Record<string, any> {
  const result: Record<string, any> = {};
  const props = blueprint.json_schema.properties || {};

  const contextNames = contextRecords
    .map((r) => Object.values(r.data).find((v) => typeof v === 'string'))
    .filter(Boolean)
    .slice(0, 3);

  for (const [key, prop] of Object.entries(props)) {
    const kLower = key.toLowerCase();
    if (prop.enum && prop.enum.length > 0) {
      result[key] = prop.enum[Math.min(1, prop.enum.length - 1)];
    } else if (prop.type === 'string') {
      if (key === blueprint.ui_config?.primaryField || kLower.includes('title') || kLower.includes('name') || kLower.includes('host')) {
        result[key] = `Synthesized: ${userQuery.slice(0, 48).replace(/[?.!]+$/, '')}`;
      } else if (kLower.includes('location') || kLower.includes('region')) {
        result[key] = 'Convergence Nexus — Sector IV';
      } else if (kLower.includes('motive') || kLower.includes('thesis') || kLower.includes('summary')) {
        result[key] = `Derived from ${contextRecords.length} context records (${contextNames.join(', ') || 'active collection'}): ${userQuery}`;
      } else {
        result[key] = `Grounded synthesis linking ${contextNames.join(' & ') || 'selected records'}`;
      }
    } else if (prop.type === 'integer' || prop.type === 'number') {
      result[key] = 32;
    } else if (prop.type === 'boolean') {
      result[key] = true;
    } else if (prop.type === 'array') {
      result[key] = [
        `Cross-referenced insight from ${contextNames[0] || 'Record #1'}`,
        `Escalation trigger tied to query: "${userQuery.slice(0, 60)}"`,
        `Actionable hook ready for collection deployment`
      ];
    }
  }

  return result;
}
