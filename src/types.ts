export type SchemaFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

export interface SchemaProperty {
  type: SchemaFieldType;
  description: string;
  enum?: string[];
  items?: {
    type: SchemaFieldType;
    enum?: string[];
    properties?: Record<string, SchemaProperty>;
  };
  properties?: Record<string, SchemaProperty>;
}

export interface JsonSchemaDefinition {
  type: 'object';
  properties: Record<string, SchemaProperty>;
  required: string[];
}

export interface BlueprintUiConfig {
  icon: string;
  version: string;
  primaryField: string;
  subtitleField?: string;
  badgeFields?: string[];
  colorAccent?: string;
}

export interface Blueprint {
  id: string;
  name: string;
  description: string;
  json_schema: JsonSchemaDefinition;
  extraction_prompt_template: string;
  ui_config: BlueprintUiConfig;
  created_at: string;
  updated_at: string;
  record_count?: number;
}

export interface StruxRecord {
  id: string;
  blueprint_id: string;
  data: Record<string, any>;
  raw_source?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedPrompt {
  id: string;
  name: string;
  system_instruction: string;
  default_blueprint_ids: string[];
  created_at?: string;
}

export interface StagedExtractionItem {
  tempId: string;
  data: Record<string, any>;
  raw_source: string;
  isValid: boolean;
  validationErrors: string[];
  selected: boolean;
}

export interface ContextCartItem {
  record: StruxRecord;
  blueprintName: string;
  blueprintIcon: string;
  primaryTitle: string;
}
