import React, { useState, useEffect } from 'react';
import {
  Wand2,
  Plus,
  Trash2,
  Save,
  Sparkles,
  Code2,
  Table2,
  MessageSquarePlus,
  CheckCircle2,
  AlertCircle,
  Copy,
  FilePlus2,
  ArrowRight,
  ClipboardCopy,
  ClipboardPaste,
  Eye,
  Check
} from 'lucide-react';
import type { Blueprint, SchemaFieldType, SchemaProperty } from '../types';
import { api } from '../api';
import { BlueprintIcon, ICON_OPTIONS } from './BlueprintIcon';
import {
  buildChatbotSchemaArchitectPrompt,
  extractJsonFromClipboardText,
  normalizeParsedChatbotSchema
} from '../utils/clipboardBridge';

interface SchemaArchitectViewProps {
  blueprints: Blueprint[];
  activeBlueprint: Blueprint | null;
  onSelectBlueprint: (bp: Blueprint) => void;
  onBlueprintSaved: (bp: Blueprint) => void;
  onBlueprintDeleted: (id: string) => void;
  onNavigateToExtractor: (bp: Blueprint) => void;
}

interface EditableFieldRow {
  field_name: string;
  type: SchemaFieldType;
  description: string;
  required: boolean;
  enum_csv: string;
}

const SAMPLE_META_PROMPTS = [
  {
    label: 'TTRPG Encounters & Intrigue',
    prompt:
      'I want to track TTRPG encounters with motives, clues, relationship matrices, primary NPC/antagonist, location, and intensity levels (Low, Moderate, High, Deadly).'
  },
  {
    label: 'Server Cluster Nodes',
    prompt:
      'Track bare-metal and cloud server nodes with hostname, environment tier, health status, CPU cores, memory GB, active services list, and incident notes.'
  },
  {
    label: 'Engineering Bug & Task Triage',
    prompt:
      'Track engineering bug reports and action items from messy Slack threads: task title, owner, priority enum, affected microservice, reproduction steps array, and acceptance criteria.'
  },
  {
    label: 'Book & Research Synthesis',
    prompt:
      'Atomic research notes from books and papers: concept title, source citation, domain category, epistemic status enum, core thesis summary, and key takeaways array.'
  }
];

export function SchemaArchitectView({
  blueprints,
  activeBlueprint,
  onSelectBlueprint,
  onBlueprintSaved,
  onBlueprintDeleted,
  onNavigateToExtractor
}: SchemaArchitectViewProps) {
  const [editingId, setEditingId] = useState<string | null>(activeBlueprint?.id || null);
  const [name, setName] = useState(activeBlueprint?.name || '');
  const [description, setDescription] = useState(activeBlueprint?.description || '');
  const [icon, setIcon] = useState(activeBlueprint?.ui_config?.icon || 'Swords');
  const [version, setVersion] = useState(activeBlueprint?.ui_config?.version || '1.0.0');
  const [primaryField, setPrimaryField] = useState(activeBlueprint?.ui_config?.primaryField || 'title');
  const [subtitleField, setSubtitleField] = useState(activeBlueprint?.ui_config?.subtitleField || '');
  const [extractionRules, setExtractionRules] = useState(
    activeBlueprint?.extraction_prompt_template || ''
  );
  const [fields, setFields] = useState<EditableFieldRow[]>([]);

  const [domainInput, setDomainInput] = useState('');
  const [refinementInput, setRefinementInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editorMode, setEditorMode] = useState<'visual' | 'json'>('visual');
  const [rawSchemaJson, setRawSchemaJson] = useState('');
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'info' | 'error';
    message: string;
  } | null>(null);

  // External Chatbot Clipboard Bridge state
  const [copiedPromptType, setCopiedPromptType] = useState<'new' | 'refine' | null>(null);
  const [showPromptInspector, setShowPromptInspector] = useState(false);
  const [manualPasteDrawer, setManualPasteDrawer] = useState(false);
  const [manualPasteText, setManualPasteText] = useState('');

  useEffect(() => {
    if (activeBlueprint) {
      loadBlueprintIntoForm(activeBlueprint);
    }
  }, [activeBlueprint?.id]);

  function loadBlueprintIntoForm(bp: Blueprint) {
    setEditingId(bp.id);
    setName(bp.name);
    setDescription(bp.description);
    setIcon(bp.ui_config?.icon || 'Sparkles');
    setVersion(bp.ui_config?.version || '1.0.0');
    setPrimaryField(bp.ui_config?.primaryField || Object.keys(bp.json_schema.properties || {})[0] || '');
    setSubtitleField(bp.ui_config?.subtitleField || '');
    setExtractionRules(bp.extraction_prompt_template || '');

    const rows: EditableFieldRow[] = Object.entries(bp.json_schema?.properties || {}).map(
      ([key, prop]) => {
        const enums = prop.enum || prop.items?.enum || [];
        return {
          field_name: key,
          type: prop.type || 'string',
          description: prop.description || '',
          required: Boolean(bp.json_schema?.required?.includes(key)),
          enum_csv: enums.join(', ')
        };
      }
    );
    setFields(rows);
    setRawSchemaJson(JSON.stringify(bp.json_schema, null, 2));
  }

  function handleStartNewBlueprint() {
    setEditingId(null);
    setName('New Domain Blueprint');
    setDescription('Describe what this collection tracks.');
    setIcon('Sparkles');
    setVersion('1.0.0');
    setPrimaryField('title');
    setSubtitleField('');
    setExtractionRules('Keep extracted values concise and factual.');
    const initialRows: EditableFieldRow[] = [
      {
        field_name: 'title',
        type: 'string',
        description: 'Primary display title or identifier of the record.',
        required: true,
        enum_csv: ''
      },
      {
        field_name: 'category',
        type: 'string',
        description: 'Classification tag for filtering.',
        required: true,
        enum_csv: 'General, Priority, Archive'
      },
      {
        field_name: 'summary',
        type: 'string',
        description: 'Concise summary extracted from the source text.',
        required: true,
        enum_csv: ''
      }
    ];
    setFields(initialRows);
    setRawSchemaJson(JSON.stringify(buildJsonSchemaFromRows(initialRows), null, 2));
    setStatusBanner({
      type: 'info',
      message: 'Started a fresh Blueprint draft. Use the AI Meta-Prompt Architect or Copy Chatbot Prompt below.'
    });
  }

  function buildJsonSchemaFromRows(rows: EditableFieldRow[]): Blueprint['json_schema'] {
    const properties: Record<string, SchemaProperty> = {};
    const required: string[] = [];

    for (const r of rows) {
      const cleanName = r.field_name.trim().replace(/\s+/g, '_');
      if (!cleanName) continue;
      const enumList = r.enum_csv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const prop: SchemaProperty = {
        type: r.type,
        description: r.description.trim() || `Value for ${cleanName}`
      };

      if (r.type === 'array') {
        prop.items = {
          type: 'string',
          ...(enumList.length > 0 ? { enum: enumList } : {})
        };
      } else if (enumList.length > 0 && r.type === 'string') {
        prop.enum = enumList;
      }

      properties[cleanName] = prop;
      if (r.required) required.push(cleanName);
    }

    return {
      type: 'object',
      properties,
      required
    };
  }

  function getActiveChatbotPrompt(isRefinement = false): string {
    const inputText = isRefinement
      ? refinementInput.trim() || domainInput.trim()
      : domainInput.trim();
    return buildChatbotSchemaArchitectPrompt({
      userInput:
        inputText ||
        `Design a comprehensive schema for "${name}" (${description})`,
      isRefinement,
      currentBlueprint: isRefinement
        ? {
            name,
            description,
            extraction_prompt_template: extractionRules,
            json_schema: buildJsonSchemaFromRows(fields)
          }
        : undefined
    });
  }

  async function handleCopyChatbotPrompt(isRefinement = false) {
    try {
      const promptStr = getActiveChatbotPrompt(isRefinement);
      await navigator.clipboard.writeText(promptStr);
      setCopiedPromptType(isRefinement ? 'refine' : 'new');
      setStatusBanner({
        type: 'info',
        message:
          'Tailored Schema Architect prompt copied to your clipboard! Paste it into any chatbot (ChatGPT, Claude, Gemini), copy its JSON reply, then click "Read & Parse Output from Clipboard".'
      });
      setTimeout(() => setCopiedPromptType(null), 3500);
    } catch (err: any) {
      setShowPromptInspector(true);
      setStatusBanner({
        type: 'error',
        message: `Clipboard write blocked by browser (${err.message}). Expanded prompt below for manual copy.`
      });
    }
  }

  function applyImportedChatbotText(rawText: string, asRefinement = false) {
    const parsedJson = extractJsonFromClipboardText(rawText);
    const normalized = normalizeParsedChatbotSchema(parsedJson);

    if (!asRefinement) {
      setEditingId(null);
    }
    setName(normalized.name);
    setDescription(normalized.description);
    setIcon(normalized.icon);
    setPrimaryField(normalized.primaryField);
    setSubtitleField(normalized.subtitleField);
    setExtractionRules(normalized.extraction_prompt_template);

    const newRows: EditableFieldRow[] = Object.entries(
      normalized.json_schema.properties || {}
    ).map(([k, p]) => ({
      field_name: k,
      type: p.type || 'string',
      description: p.description || '',
      required: Boolean(normalized.json_schema.required?.includes(k)),
      enum_csv: (p.enum || p.items?.enum || []).join(', ')
    }));

    setFields(newRows);
    setRawSchemaJson(JSON.stringify(normalized.json_schema, null, 2));
    setManualPasteDrawer(false);
    setManualPasteText('');
    setStatusBanner({
      type: 'success',
      message: `Parsed "${normalized.name}" (${newRows.length} fields) directly from your clipboard! Review fields below and click Save Blueprint.`
    });
  }

  async function handleReadSchemaFromClipboard(asRefinement = false) {
    try {
      const clipText = await navigator.clipboard.readText();
      applyImportedChatbotText(clipText, asRefinement);
    } catch (err: any) {
      setManualPasteDrawer(true);
      setStatusBanner({
        type: 'error',
        message: `${err.message || 'Could not read clipboard directly.'} You can also paste the chatbot output into the box below.`
      });
    }
  }

  async function handleGenerateFromPrompt(isRefinement: boolean) {
    const promptText = isRefinement ? refinementInput.trim() : domainInput.trim();
    if (!promptText) return;

    setIsGenerating(true);
    setStatusBanner(null);
    try {
      const currentDraft: Partial<Blueprint> | undefined = isRefinement
        ? {
            name,
            description,
            extraction_prompt_template: extractionRules,
            json_schema: buildJsonSchemaFromRows(fields),
            ui_config: {
              icon,
              version,
              primaryField,
              subtitleField: subtitleField || undefined
            }
          }
        : undefined;

      const designed = await api.designSchema(promptText, currentDraft);
      if (!isRefinement) {
        setEditingId(null);
      }
      setName(designed.name);
      setDescription(designed.description);
      setIcon(designed.ui_config.icon || 'Sparkles');
      setVersion(designed.ui_config.version || '1.0.0');
      setPrimaryField(designed.ui_config.primaryField || '');
      setSubtitleField(designed.ui_config.subtitleField || '');
      setExtractionRules(designed.extraction_prompt_template || '');

      const newRows: EditableFieldRow[] = Object.entries(designed.json_schema.properties || {}).map(
        ([k, p]) => ({
          field_name: k,
          type: p.type || 'string',
          description: p.description || '',
          required: Boolean(designed.json_schema.required?.includes(k)),
          enum_csv: (p.enum || p.items?.enum || []).join(', ')
        })
      );
      setFields(newRows);
      setRawSchemaJson(JSON.stringify(designed.json_schema, null, 2));
      if (isRefinement) setRefinementInput('');

      setStatusBanner({
        type: 'success',
        message: designed.simulated
          ? 'Schema designed via local Architect rules (or use the Chatbot Clipboard Bridge on the left). Review and click Save Blueprint.'
          : 'Schema designed via Gemini 3.8 Flash Structured Outputs! Review fields and click Save Blueprint.'
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err.message || 'Failed to generate schema.'
      });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSaveBlueprint() {
    setIsSaving(true);
    setStatusBanner(null);
    try {
      let finalSchema = buildJsonSchemaFromRows(fields);
      if (editorMode === 'json') {
        finalSchema = JSON.parse(rawSchemaJson);
      }

      const badgeFields = Object.entries(finalSchema.properties || {})
        .filter(([, p]) => (p.enum && p.enum.length > 0) || p.type === 'boolean')
        .map(([k]) => k)
        .slice(0, 3);

      const payload: Partial<Blueprint> = {
        name: name.trim() || 'Untitled Blueprint',
        description: description.trim(),
        json_schema: finalSchema,
        extraction_prompt_template: extractionRules.trim(),
        ui_config: {
          icon,
          version: version.trim() || '1.0.0',
          primaryField: primaryField || Object.keys(finalSchema.properties || {})[0] || 'title',
          subtitleField: subtitleField || undefined,
          badgeFields,
          colorAccent: 'indigo'
        }
      };

      const saved = editingId
        ? await api.updateBlueprint(editingId, payload)
        : await api.createBlueprint(payload);

      onBlueprintSaved(saved);
      loadBlueprintIntoForm(saved);
      setStatusBanner({
        type: 'success',
        message: `Saved Blueprint "${saved.name}" (v${saved.ui_config.version}). Ready for unstructured data ingestion!`
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err.message || 'Invalid JSON Schema or save error.'
      });
    } finally {
      setIsSaving(false);
    }
  }

  function updateFieldRow(index: number, patch: Partial<EditableFieldRow>) {
    const next = fields.map((r, i) => (i === index ? { ...r, ...patch } : r));
    setFields(next);
    setRawSchemaJson(JSON.stringify(buildJsonSchemaFromRows(next), null, 2));
  }

  function addFieldRow() {
    const next: EditableFieldRow[] = [
      ...fields,
      {
        field_name: `field_${fields.length + 1}`,
        type: 'string',
        description: 'Describe what the LLM extractor should place in this field.',
        required: false,
        enum_csv: ''
      }
    ];
    setFields(next);
    setRawSchemaJson(JSON.stringify(buildJsonSchemaFromRows(next), null, 2));
  }

  function removeFieldRow(index: number) {
    const next = fields.filter((_, i) => i !== index);
    setFields(next);
    setRawSchemaJson(JSON.stringify(buildJsonSchemaFromRows(next), null, 2));
  }

  const currentSchemaPreview = buildJsonSchemaFromRows(fields);
  const availableFieldNames = fields.map((f) => f.field_name).filter(Boolean);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      {/* Left Column: Blueprint Library + AI Meta-Prompt Designer + Chatbot Clipboard Bridge */}
      <div className="xl:col-span-4 space-y-6">
        {/* Saved Blueprints List */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                Blueprint Templates
              </h2>
              <p className="text-xs text-slate-400">
                Select a domain schema or architect a new one
              </p>
            </div>
            <button
              onClick={handleStartNewBlueprint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 border border-indigo-500/30 transition cursor-pointer"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              New Blank
            </button>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {blueprints.map((bp) => {
              const isSelected = bp.id === editingId;
              return (
                <div
                  key={bp.id}
                  onClick={() => {
                    onSelectBlueprint(bp);
                    loadBlueprintIntoForm(bp);
                  }}
                  className={`group flex items-center justify-between p-3 rounded-lg border transition cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-950/50 border-indigo-500/60 text-white'
                      : 'bg-slate-950/60 border-slate-800/80 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-lg ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800 text-slate-400 group-hover:text-slate-200'
                      }`}
                    >
                      <BlueprintIcon name={bp.ui_config?.icon} className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-2">
                        <span>{bp.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          v{bp.ui_config?.version || '1.0'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 truncate">
                        {Object.keys(bp.json_schema?.properties || {}).length} fields •{' '}
                        {bp.record_count ?? 0} records
                      </div>
                    </div>
                  </div>
                  {blueprints.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onBlueprintDeleted(bp.id);
                      }}
                      title="Delete Blueprint"
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Meta-Prompt Architect Generator & Chatbot Clipboard Bridge */}
        <div className="bg-slate-900/90 border border-indigo-500/30 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
                <Wand2 className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-semibold text-white">
                AI Schema Architect (Meta-Prompt)
              </h3>
            </div>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Describe what you want to track in natural language or paste a sample of messy text:
          </p>

          <textarea
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            rows={4}
            placeholder="e.g., I want to track TTRPG encounters with motives, clues, relationship matrices, and intensity levels..."
            className="w-full rounded-lg bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none p-3 text-xs text-slate-100 placeholder-slate-500 resize-none"
          />

          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_META_PROMPTS.map((sample) => (
              <button
                key={sample.label}
                type="button"
                onClick={() => setDomainInput(sample.prompt)}
                className="text-[11px] px-2 py-1 rounded-md bg-slate-800/90 hover:bg-slate-800 text-slate-300 border border-slate-700/70 transition cursor-pointer"
              >
                {sample.label}
              </button>
            ))}
          </div>

          {/* Direct API Execution Button */}
          <button
            onClick={() => handleGenerateFromPrompt(false)}
            disabled={isGenerating || !domainInput.trim()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white shadow-md shadow-indigo-950/50 transition cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            {isGenerating ? 'Architecting JSON Schema...' : 'Propose New Schema via API'}
          </button>

          {/* Chatbot Clipboard Bridge Card */}
          <div className="p-3.5 rounded-xl bg-slate-950/90 border border-emerald-500/30 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                Chatbot Clipboard Bridge (Copy → Paste)
              </span>
              <button
                type="button"
                onClick={() => setShowPromptInspector(!showPromptInspector)}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <Eye className="w-3 h-3" />
                {showPromptInspector ? 'Hide Prompt' : 'Preview Prompt'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Use any external chatbot (ChatGPT, Claude, Gemini): copy the tailored prompt in 1 click, then read & parse the chatbot's JSON response straight from your clipboard.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleCopyChatbotPrompt(false)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-indigo-200 border border-indigo-500/40 transition cursor-pointer"
              >
                {copiedPromptType === 'new' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Prompt Copied!
                  </>
                ) : (
                  <>
                    <ClipboardCopy className="w-3.5 h-3.5 text-indigo-400" />
                    1. Copy Prompt
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleReadSchemaFromClipboard(false)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200 border border-emerald-500/40 transition cursor-pointer"
              >
                <ClipboardPaste className="w-3.5 h-3.5 text-emerald-400" />
                2. Read Clipboard JSON
              </button>
            </div>

            {showPromptInspector && (
              <div className="pt-2 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>TAILORED SCHEMA ARCHITECT PROMPT</span>
                  <button
                    type="button"
                    onClick={() => handleCopyChatbotPrompt(false)}
                    className="text-indigo-400 hover:text-indigo-300 cursor-pointer"
                  >
                    Copy Text
                  </button>
                </div>
                <pre className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-300 max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {getActiveChatbotPrompt(false)}
                </pre>
              </div>
            )}

            {manualPasteDrawer && (
              <div className="pt-2 space-y-2 border-t border-slate-800">
                <span className="text-[11px] text-amber-300 block">
                  Paste Chatbot JSON Response Manually:
                </span>
                <textarea
                  value={manualPasteText}
                  onChange={(e) => setManualPasteText(e.target.value)}
                  rows={4}
                  placeholder="Paste the chatbot response (even with ```json fences) here..."
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 p-2 font-mono text-xs text-emerald-300"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setManualPasteDrawer(false)}
                    className="px-2.5 py-1 text-xs text-slate-400 hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        applyImportedChatbotText(manualPasteText, false);
                      } catch (e: any) {
                        setStatusBanner({ type: 'error', message: e.message });
                      }
                    }}
                    className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                  >
                    Parse Pasted Output
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Interactive AI Refinement Chat */}
          <div className="pt-3 border-t border-slate-800 space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <MessageSquarePlus className="w-3.5 h-3.5 text-indigo-400" />
              Interactive AI Field Refinement
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={refinementInput}
                onChange={(e) => setRefinementInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleGenerateFromPrompt(true);
                }}
                placeholder="e.g., Add a priority enum & target_date..."
                className="flex-1 rounded-lg bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none px-3 py-2 text-xs text-slate-100 placeholder-slate-500"
              />
              <button
                onClick={() => handleGenerateFromPrompt(true)}
                disabled={isGenerating || !refinementInput.trim()}
                className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-indigo-300 border border-slate-700 transition cursor-pointer"
              >
                Tweak
              </button>
              <button
                type="button"
                onClick={() => handleCopyChatbotPrompt(true)}
                title="Copy refinement prompt including current schema to clipboard"
                className="px-2.5 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 transition cursor-pointer"
              >
                <ClipboardCopy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Visual Schema Builder & Blueprint Editor */}
      <div className="xl:col-span-8 space-y-6">
        {statusBanner && (
          <div
            className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs ${
              statusBanner.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                : statusBanner.type === 'error'
                ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                : 'bg-indigo-950/40 border-indigo-500/40 text-indigo-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {statusBanner.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              )}
              <span>{statusBanner.message}</span>
            </div>
            {editingId && activeBlueprint && (
              <button
                onClick={() => onNavigateToExtractor(activeBlueprint)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 font-medium shrink-0 transition cursor-pointer"
              >
                Ingest Data <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Blueprint Metadata & UI Mapping Header */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
                <BlueprintIcon name={icon} className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-white">
                    {editingId ? 'Edit Blueprint Schema' : 'New Blueprint Draft'}
                  </h2>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-indigo-300 border border-slate-700">
                    v{version}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Every field description acts as an explicit micro-prompt for Gemini Structured Outputs
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800">
                <button
                  onClick={() => setEditorMode('visual')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                    editorMode === 'visual'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Table2 className="w-3.5 h-3.5" />
                  Visual Builder
                </button>
                <button
                  onClick={() => {
                    setRawSchemaJson(JSON.stringify(buildJsonSchemaFromRows(fields), null, 2));
                    setEditorMode('json');
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                    editorMode === 'json'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  JSON Schema
                </button>
              </div>

              <button
                onClick={handleSaveBlueprint}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                {isSaving ? 'Saving...' : 'Save Blueprint'}
              </button>
            </div>
          </div>

          {/* Metadata Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-5">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                Blueprint Title
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none px-3 py-2 text-sm text-white"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                Icon
              </label>
              <select
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none px-3 py-2 text-sm text-white"
              >
                {ICON_OPTIONS.map((ic) => (
                  <option key={ic} value={ic}>
                    {ic}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                Version
              </label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none px-3 py-2 text-sm font-mono text-white"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                Primary Title Key
              </label>
              <select
                value={primaryField}
                onChange={(e) => setPrimaryField(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none px-2.5 py-2 text-xs font-mono text-white"
              >
                {availableFieldNames.map((fn) => (
                  <option key={fn} value={fn}>
                    {fn}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-6">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                Domain Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none px-3 py-2 text-xs text-slate-200"
              />
            </div>

            <div className="md:col-span-6">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                Custom Extraction Rules (Blueprint Prompt Template)
              </label>
              <input
                type="text"
                value={extractionRules}
                onChange={(e) => setExtractionRules(e.target.value)}
                placeholder="e.g., Translate all values to English and keep tone concise."
                className="w-full rounded-lg bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none px-3 py-2 text-xs text-slate-200"
              />
            </div>
          </div>

          {/* Visual Builder Table OR Raw JSON Schema Editor */}
          {editorMode === 'visual' ? (
            <div className="pt-2">
              <div className="overflow-x-auto border border-slate-800 rounded-xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-950/90 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="py-2.5 px-3 w-44">field_name</th>
                      <th className="py-2.5 px-3 w-32">type</th>
                      <th className="py-2.5 px-3">description (LLM Extractor Instruction)</th>
                      <th className="py-2.5 px-3 w-48">enum (comma-separated)</th>
                      <th className="py-2.5 px-3 w-20 text-center">required</th>
                      <th className="py-2.5 px-3 w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-xs">
                    {fields.map((row, idx) => (
                      <tr key={idx} className="bg-slate-900/40 hover:bg-slate-900/80 transition">
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.field_name}
                            onChange={(e) => updateFieldRow(idx, { field_name: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded px-2.5 py-1.5 font-mono text-xs text-indigo-300"
                          />
                        </td>
                        <td className="p-2">
                          <select
                            value={row.type}
                            onChange={(e) =>
                              updateFieldRow(idx, { type: e.target.value as SchemaFieldType })
                            }
                            className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded px-2 py-1.5 font-mono text-xs text-amber-300"
                          >
                            <option value="string">string</option>
                            <option value="array">array (string[])</option>
                            <option value="number">number</option>
                            <option value="integer">integer</option>
                            <option value="boolean">boolean</option>
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.description}
                            onChange={(e) => updateFieldRow(idx, { description: e.target.value })}
                            placeholder="Explain what Gemini should extract for this property..."
                            className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded px-2.5 py-1.5 text-xs text-slate-200"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.enum_csv}
                            onChange={(e) => updateFieldRow(idx, { enum_csv: e.target.value })}
                            placeholder={
                              row.type === 'string' || row.type === 'array'
                                ? 'e.g. Low, High, Deadly'
                                : '—'
                            }
                            disabled={row.type !== 'string' && row.type !== 'array'}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 disabled:opacity-40 rounded px-2.5 py-1.5 text-xs text-emerald-300 font-mono"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <input
                            type="checkbox"
                            checked={row.required}
                            onChange={(e) => updateFieldRow(idx, { required: e.target.checked })}
                            className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            onClick={() => removeFieldRow(idx)}
                            className="p-1.5 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                            title="Remove field"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={addFieldRow}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-indigo-400" />
                  Add Property Field
                </button>
                <span className="text-xs text-slate-400">
                  {fields.length} total properties • {fields.filter((f) => f.required).length} required
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-mono">
                  Draft-07 / OpenAPI 3.0 Subset (Gemini responseSchema Compatible)
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      JSON.stringify(currentSchemaPreview, null, 2)
                    );
                  }}
                  className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy Schema
                </button>
              </div>
              <textarea
                value={rawSchemaJson}
                onChange={(e) => setRawSchemaJson(e.target.value)}
                rows={16}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none p-4 font-mono text-xs text-emerald-300"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
