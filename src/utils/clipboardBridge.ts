import type { Blueprint, JsonSchemaDefinition, SchemaProperty } from '../types';

export const PROMPT_A_SCHEMA_ARCHITECT =
  "You are the Strux Schema Architect. Your goal is to analyze the user's domain description or sample unstructured text and design an optimal, rigorous JSON Schema. Every property must include a clear description attribute, because those descriptions will later act as instructions for an LLM extractor. Favor clean, predictable data types (strings, arrays of strings, enums, booleans, numbers) and avoid overly deep nesting unless necessary.";

export const PROMPT_B_DATA_EXTRACTOR =
  "You are the Strux Data Ingestion Engine. Extract information from the provided unstructured text and map it strictly into the provided JSON Schema. Follow the instructions in each field's description. Do not invent facts not present or implied in the source text; if a non-required field is missing, omit it or set it to null. Output valid JSON matching the schema.";

/**
 * Generates a self-contained prompt that the user can paste into any external LLM chatbot
 * (ChatGPT, Claude, Gemini Web, DeepSeek, etc.) to design or refine a Blueprint Schema.
 */
export function buildChatbotSchemaArchitectPrompt(params: {
  userInput: string;
  isRefinement?: boolean;
  currentBlueprint?: {
    name: string;
    description: string;
    extraction_prompt_template: string;
    json_schema: JsonSchemaDefinition;
  };
}): string {
  const { userInput, isRefinement, currentBlueprint } = params;

  const currentContext =
    isRefinement && currentBlueprint
      ? `\n### CURRENT BLUEPRINT SCHEMA TO REFINE\n\`\`\`json\n${JSON.stringify(
          currentBlueprint,
          null,
          2
        )}\n\`\`\`\n`
      : '';

  return `${PROMPT_A_SCHEMA_ARCHITECT}
${currentContext}
### USER ${isRefinement ? 'REFINEMENT REQUEST' : 'DOMAIN DESCRIPTION / SAMPLE TEXT'}
${userInput.trim() || '(Describe your domain here)'}

---
### STRICT OUTPUT FORMAT INSTRUCTIONS
Respond ONLY with a single valid JSON object (no markdown commentary before or after) matching this exact structure so Strux can import it directly from the clipboard:

\`\`\`json
{
  "name": "Display Name of the Blueprint",
  "description": "1-2 sentence summary of what this schema tracks",
  "icon": "Swords | Server | BookOpen | CheckSquare | Users | Cpu | Database | Globe | Briefcase | FlaskConical | ShieldAlert | Sparkles",
  "extraction_prompt_template": "Custom instructions for extracting unstructured notes into this schema",
  "fields": [
    {
      "field_name": "snake_case_key",
      "type": "string | array | number | integer | boolean",
      "description": "Detailed LLM extraction instruction for this specific field",
      "required": true,
      "enum_values": ["OptionalAllowedValue1", "OptionalAllowedValue2"]
    }
  ]
}
\`\`\``;
}

/**
 * Generates a self-contained prompt that the user can paste into any external LLM chatbot
 * to extract unstructured text into JSON conforming strictly to the active Blueprint schema.
 */
export function buildChatbotDataExtractionPrompt(params: {
  blueprint: Blueprint;
  rawText: string;
  mode: 'single' | 'batch';
  customInstructions?: string;
}): string {
  const { blueprint, rawText, mode, customInstructions } = params;

  const fieldDescriptions = Object.entries(blueprint.json_schema.properties || {})
    .map(([key, prop]) => {
      const isReq = blueprint.json_schema.required?.includes(key) ? 'REQUIRED' : 'OPTIONAL';
      const enumInfo =
        prop.enum && prop.enum.length > 0
          ? ` | Allowed enum values: [${prop.enum.map((e) => `"${e}"`).join(', ')}]`
          : prop.items?.enum && prop.items.enum.length > 0
          ? ` | Allowed array item enums: [${prop.items.enum.map((e) => `"${e}"`).join(', ')}]`
          : '';
      return `- "${key}" (${prop.type}, ${isReq}${enumInfo}): ${prop.description}`;
    })
    .join('\n');

  const rules = [blueprint.extraction_prompt_template, customInstructions]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join('\n');

  // Construct an example skeleton object matching the blueprint
  const exampleObj: Record<string, any> = {};
  for (const [key, prop] of Object.entries(blueprint.json_schema.properties || {})) {
    if (prop.enum && prop.enum.length > 0) {
      exampleObj[key] = prop.enum[0];
    } else if (prop.type === 'string') {
      exampleObj[key] = `<${prop.description || key}>`;
    } else if (prop.type === 'array') {
      exampleObj[key] = [`<item 1 for ${key}>`, `<item 2 for ${key}>`];
    } else if (prop.type === 'integer' || prop.type === 'number') {
      exampleObj[key] = 0;
    } else if (prop.type === 'boolean') {
      exampleObj[key] = true;
    }
  }

  const expectedFormatExample =
    mode === 'batch'
      ? JSON.stringify([exampleObj], null, 2)
      : JSON.stringify(exampleObj, null, 2);

  return `${PROMPT_B_DATA_EXTRACTOR}

### TARGET BLUEPRINT: ${blueprint.name}
${blueprint.description}

### TARGET JSON SCHEMA DEFINITION
\`\`\`json
${JSON.stringify(blueprint.json_schema, null, 2)}
\`\`\`

### FIELD-BY-FIELD EXTRACTION INSTRUCTIONS
${fieldDescriptions}
${rules ? `\n### ADDITIONAL EXTRACTION RULES\n${rules}\n` : ''}
### EXTRACTION MODE
${
  mode === 'batch'
    ? 'BATCH EXTRACTION: Extract ALL distinct entities/items from the unstructured text below and return a JSON Array of objects (`[ { ... }, { ... } ]`).'
    : 'SINGLE OBJECT EXTRACTION: Extract the information from the unstructured text below into a single JSON object (`{ ... }`).'
}

### RAW UNSTRUCTURED SOURCE TEXT
"""
${rawText.trim() || '(Paste your unstructured text here)'}
"""

---
### STRICT OUTPUT FORMAT INSTRUCTIONS
Respond ONLY with valid JSON matching the schema above (${
    mode === 'batch' ? 'a JSON Array `[...]`' : 'a single JSON Object `{...}`'
  }). Do not include any conversational filler outside the JSON block:

\`\`\`json
${expectedFormatExample}
\`\`\``;
}

/**
 * Extracts and parses JSON from messy clipboard text (handles ```json fences,
 * leading/trailing chatbot explanations, and smart quotes).
 */
export function extractJsonFromClipboardText(rawClipboard: string): any {
  const trimmed = rawClipboard.trim();
  if (!trimmed) {
    throw new Error('Clipboard is empty. Copy the JSON response from your chatbot first.');
  }

  // 1. Try direct JSON.parse first
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue to fenced/substring extraction
  }

  // 2. Check for ```json ... ``` or ``` ... ``` markdown code blocks
  const fenceRegex = /```(?:json|javascript|ts)?\s*([\s\S]*?)```/i;
  const fenceMatch = trimmed.match(fenceRegex);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue to bracket boundary scan
    }
  }

  // 3. Scan for the outermost JSON object `{ ... }` or array `[ ... ]`
  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');
  let startIdx = -1;
  let endIdx = -1;

  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    startIdx = firstBracket;
    endIdx = trimmed.lastIndexOf(']');
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
    endIdx = trimmed.lastIndexOf('}');
  }

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const candidate = trimmed.slice(startIdx, endIdx + 1);
    try {
      return JSON.parse(candidate);
    } catch (err: any) {
      throw new Error(`Found JSON-like block in clipboard, but syntax is invalid: ${err.message}`);
    }
  }

  throw new Error(
    'Could not find valid JSON in the clipboard content. Make sure you copied the JSON output from your chatbot.'
  );
}

/**
 * Normalizes a parsed chatbot schema object (either Strux Meta-Format with `fields[]`
 * OR a raw Draft-07 JSON Schema with `properties`) into standard Strux Blueprint state.
 */
export function normalizeParsedChatbotSchema(parsed: any): {
  name: string;
  description: string;
  icon: string;
  extraction_prompt_template: string;
  json_schema: JsonSchemaDefinition;
  primaryField: string;
  subtitleField: string;
} {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object representing a Blueprint or JSON Schema.');
  }

  // Case A: Strux Meta-Prompt format with `fields` array
  if (Array.isArray(parsed.fields)) {
    const properties: Record<string, SchemaProperty> = {};
    const required: string[] = [];
    let primaryField = '';
    let subtitleField = '';

    for (const f of parsed.fields) {
      const key = String(f.field_name || f.name || 'field')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_');
      if (!key) continue;

      const rawType = String(f.type || 'string').toLowerCase();
      const validType = ['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(
        rawType
      )
        ? (rawType as SchemaProperty['type'])
        : 'string';

      const enums = Array.isArray(f.enum_values)
        ? f.enum_values.map(String).filter(Boolean)
        : Array.isArray(f.enum)
        ? f.enum.map(String).filter(Boolean)
        : [];

      const prop: SchemaProperty = {
        type: validType,
        description: String(f.description || `Extracted value for ${key}`)
      };

      if (validType === 'array') {
        prop.items = {
          type: 'string',
          ...(enums.length > 0 ? { enum: enums } : {})
        };
      } else if (enums.length > 0 && validType === 'string') {
        prop.enum = enums;
      }

      properties[key] = prop;
      if (f.required) required.push(key);

      if (!primaryField && validType === 'string' && enums.length === 0) {
        primaryField = key;
      } else if (primaryField && !subtitleField && validType === 'string' && enums.length === 0) {
        subtitleField = key;
      }
    }

    const keys = Object.keys(properties);
    if (!primaryField && keys.length > 0) primaryField = keys[0];

    return {
      name: String(parsed.name || parsed.title || 'Imported Chatbot Blueprint'),
      description: String(
        parsed.description || 'Structured schema imported from external chatbot.'
      ),
      icon: String(parsed.icon || 'Sparkles'),
      extraction_prompt_template: String(
        parsed.extraction_prompt_template || 'Keep extracted values concise and factual.'
      ),
      json_schema: {
        type: 'object',
        properties,
        required
      },
      primaryField,
      subtitleField
    };
  }

  // Case B: Direct JSON Schema object (`{ properties: { ... }, required: [...] }` or wrapped in `json_schema`)
  const rawSchema = parsed.json_schema?.properties ? parsed.json_schema : parsed;
  if (rawSchema.properties && typeof rawSchema.properties === 'object') {
    const properties: Record<string, SchemaProperty> = {};
    let primaryField = '';
    let subtitleField = '';

    for (const [k, v] of Object.entries<any>(rawSchema.properties)) {
      const cleanKey = k.trim().replace(/\s+/g, '_');
      const validType = ['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(
        v?.type
      )
        ? v.type
        : 'string';

      const prop: SchemaProperty = {
        type: validType,
        description: String(v?.description || `Extracted value for ${cleanKey}`)
      };
      if (Array.isArray(v?.enum) && v.enum.length > 0) {
        prop.enum = v.enum.map(String);
      }
      if (validType === 'array') {
        prop.items = {
          type: v?.items?.type || 'string',
          ...(Array.isArray(v?.items?.enum) ? { enum: v.items.enum.map(String) } : {})
        };
      }
      properties[cleanKey] = prop;

      if (!primaryField && validType === 'string' && !prop.enum) {
        primaryField = cleanKey;
      } else if (primaryField && !subtitleField && validType === 'string' && !prop.enum) {
        subtitleField = cleanKey;
      }
    }

    const keys = Object.keys(properties);
    if (!primaryField && keys.length > 0) primaryField = keys[0];

    return {
      name: String(parsed.name || rawSchema.title || 'Imported Chatbot Schema'),
      description: String(
        parsed.description || rawSchema.description || 'Imported JSON Schema from clipboard.'
      ),
      icon: String(parsed.ui_config?.icon || parsed.icon || 'Sparkles'),
      extraction_prompt_template: String(
        parsed.extraction_prompt_template || 'Keep extracted values concise and factual.'
      ),
      json_schema: {
        type: 'object',
        properties,
        required: Array.isArray(rawSchema.required) ? rawSchema.required.map(String) : []
      },
      primaryField,
      subtitleField
    };
  }

  throw new Error(
    'Unrecognized JSON schema structure. Expected either a Strux Architect JSON object (`fields` array) or a standard JSON Schema (`properties` object).'
  );
}
