import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  Send,
  Database,
  CheckCircle2,
  Trash2,
  BookmarkPlus,
  Code2,
  Layers,
  PlusCircle,
  Cpu
} from 'lucide-react';
import type { Blueprint, SavedPrompt, StruxRecord } from '../types';
import { api } from '../api';
import { BlueprintIcon } from './BlueprintIcon';

interface ContextStudioViewProps {
  blueprints: Blueprint[];
  records: StruxRecord[];
  savedPrompts: SavedPrompt[];
  onRefreshSavedPrompts: () => void;
  onRefreshRecords: () => void;
  contextCartIds: Set<string>;
  onToggleContextCart: (recordId: string) => void;
  onClearContextCart: () => void;
  onSelectAllForBlueprint: (blueprintId: string) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  generatedObject?: Record<string, any> | null;
  targetBlueprintId?: string | null;
  savedToCollection?: boolean;
  timestamp: string;
}

export function ContextStudioView({
  blueprints,
  records,
  savedPrompts,
  onRefreshSavedPrompts,
  onRefreshRecords,
  contextCartIds,
  onToggleContextCart,
  onClearContextCart,
  onSelectAllForBlueprint
}: ContextStudioViewProps) {
  const [systemInstruction, setSystemInstruction] = useState(
    savedPrompts[0]?.system_instruction ||
      'You are the Strux Context Studio analyst. Ground your answers and generated items strictly in the selected structured JSON records.'
  );
  const [userQuery, setUserQuery] = useState('');
  const [roundTripBlueprintId, setRoundTripBlueprintId] = useState<string>(
    blueprints[0]?.id || ''
  );
  const [enableRoundTripGeneration, setEnableRoundTripGeneration] = useState<boolean>(true);
  const [showContextPreviewModal, setShowContextPreviewModal] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState(false);

  // Save new prompt workflow modal state
  const [newPromptName, setNewPromptName] = useState('');
  const [showSavePromptInput, setShowSavePromptInput] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-msg',
      role: 'assistant',
      content:
        'Welcome to **Strux Context Studio**. Select structured JSON records from any collection on the left to build a high-density, zero-noise context payload. Enable **Round-Trip Structured Generation** below to generate new schema-validated objects and save them back to a collection in one click.',
      timestamp: new Date().toLocaleTimeString()
    }
  ]);

  const bpMap = useMemo(() => new Map(blueprints.map((b) => [b.id, b])), [blueprints]);

  const selectedRecords = useMemo(() => {
    return records.filter((r) => contextCartIds.has(r.id));
  }, [records, contextCartIds]);

  const formattedContextBlock = useMemo(() => {
    const payload = selectedRecords.map((r) => ({
      _record_id: r.id,
      _collection: bpMap.get(r.blueprint_id)?.name || r.blueprint_id,
      ...r.data
    }));
    return JSON.stringify(payload, null, 2);
  }, [selectedRecords, bpMap]);

  const estimatedTokenCount = useMemo(() => {
    const totalChars = systemInstruction.length + formattedContextBlock.length + userQuery.length;
    return Math.ceil(totalChars / 4);
  }, [systemInstruction, formattedContextBlock, userQuery]);

  async function handleRunQuery(presetQuery?: string) {
    const queryText = (presetQuery ?? userQuery).trim();
    if (!queryText) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: queryText,
      timestamp: new Date().toLocaleTimeString()
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!presetQuery) setUserQuery('');
    setIsExecuting(true);

    try {
      const targetBpId = enableRoundTripGeneration ? roundTripBlueprintId : null;
      const res = await api.queryContextStudio({
        system_instruction: systemInstruction,
        user_query: queryText,
        record_ids: Array.from(contextCartIds),
        target_blueprint_id: targetBpId
      });

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: res.answer,
        generatedObject: res.generatedObject || null,
        targetBlueprintId: targetBpId,
        savedToCollection: false,
        timestamp: new Date().toLocaleTimeString()
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `Error executing query: ${err.message}`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    } finally {
      setIsExecuting(false);
    }
  }

  async function handleRoundTripSave(msgId: string, blueprintId: string, data: Record<string, any>) {
    await api.createRecord(
      blueprintId,
      data,
      'Generated via Strux Context Studio (Round-Trip Saving)'
    );
    onRefreshRecords();
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, savedToCollection: true } : m))
    );
  }

  async function handleSavePromptWorkflow() {
    if (!newPromptName.trim() || !systemInstruction.trim()) return;
    await api.createSavedPrompt({
      name: newPromptName.trim(),
      system_instruction: systemInstruction.trim(),
      default_blueprint_ids: [roundTripBlueprintId].filter(Boolean)
    });
    setNewPromptName('');
    setShowSavePromptInput(false);
    onRefreshSavedPrompts();
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      {/* Left Column: Context Cart Selector & Token/Context Payload Preview */}
      <div className="xl:col-span-4 space-y-5">
        {/* Active Context Cart Summary */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Active Context Payload Cart
                </h2>
                <p className="text-xs text-slate-400">
                  Check records across collections to ground Gemini
                </p>
              </div>
            </div>
            {contextCartIds.size > 0 && (
              <button
                onClick={onClearContextCart}
                className="text-xs text-slate-400 hover:text-rose-400 transition cursor-pointer"
              >
                Clear ({contextCartIds.size})
              </button>
            )}
          </div>

          {/* Token & Context Preview Meter */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <div>
                <div className="text-xs font-mono font-semibold text-white">
                  ~{estimatedTokenCount.toLocaleString()} Tokens
                </div>
                <div className="text-[11px] text-slate-400">
                  {selectedRecords.length} structured JSON objects injected
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowContextPreviewModal(!showContextPreviewModal)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 transition cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5" />
              {showContextPreviewModal ? 'Hide JSON' : 'Inspect Payload'}
            </button>
          </div>

          {showContextPreviewModal && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                Exact System Prompt JSON Block
              </span>
              <pre className="p-3 rounded-xl bg-slate-950 border border-indigo-500/40 font-mono text-[11px] text-emerald-300 max-h-60 overflow-y-auto whitespace-pre-wrap">
                {formattedContextBlock}
              </pre>
            </div>
          )}

          {/* Cross-Collection Record Selector */}
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {blueprints.map((bp) => {
              const bpRecs = records.filter((r) => r.blueprint_id === bp.id);
              const primaryKey =
                bp.ui_config?.primaryField || Object.keys(bp.json_schema.properties || {})[0];
              return (
                <div
                  key={bp.id}
                  className="rounded-xl bg-slate-950/60 border border-slate-800/90 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                      <BlueprintIcon name={bp.ui_config?.icon} className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{bp.name}</span>
                    </div>
                    <button
                      onClick={() => onSelectAllForBlueprint(bp.id)}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
                    >
                      Select All ({bpRecs.length})
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {bpRecs.map((rec) => {
                      const checked = contextCartIds.has(rec.id);
                      const label = String(rec.data[primaryKey] || rec.id.slice(0, 8));
                      return (
                        <label
                          key={rec.id}
                          className={`flex items-center gap-2.5 p-2 rounded-lg border text-xs cursor-pointer transition ${
                            checked
                              ? 'bg-indigo-950/40 border-indigo-500/60 text-white'
                              : 'bg-slate-900/60 border-slate-800/70 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggleContextCart(rec.id)}
                            className="w-3.5 h-3.5 rounded accent-indigo-500"
                          />
                          <span className="truncate flex-1">{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Saved Prompts Library (SRD Section 4 Saved_Prompts model) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Saved Prompt Workflows
            </h3>
            <button
              onClick={() => setShowSavePromptInput(!showSavePromptInput)}
              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
            >
              <BookmarkPlus className="w-3.5 h-3.5" /> Save Current
            </button>
          </div>

          {showSavePromptInput && (
            <div className="flex gap-2">
              <input
                type="text"
                value={newPromptName}
                onChange={(e) => setNewPromptName(e.target.value)}
                placeholder="Workflow name..."
                className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs text-white"
              />
              <button
                onClick={handleSavePromptWorkflow}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium cursor-pointer"
              >
                Save
              </button>
            </div>
          )}

          <div className="space-y-2">
            {savedPrompts.map((sp) => (
              <div
                key={sp.id}
                onClick={() => {
                  setSystemInstruction(sp.system_instruction);
                  if (sp.default_blueprint_ids?.[0]) {
                    setRoundTripBlueprintId(sp.default_blueprint_ids[0]);
                  }
                }}
                className="group p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 hover:border-indigo-500/50 transition cursor-pointer flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-200">{sp.name}</div>
                  <div className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">
                    {sp.system_instruction}
                  </div>
                </div>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await api.deleteSavedPrompt(sp.id);
                    onRefreshSavedPrompts();
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Column: Context Studio Execution & Round-Trip Saving */}
      <div className="xl:col-span-8 flex flex-col bg-slate-900/90 border border-slate-800 rounded-xl shadow-lg overflow-hidden min-h-[680px]">
        {/* System Directive Header */}
        <div className="p-4 bg-slate-950/80 border-b border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400">
              System Instruction Directive
            </span>
            <span className="text-[11px] text-slate-400">
              Grounded in {selectedRecords.length} selected record(s)
            </span>
          </div>
          <textarea
            value={systemInstruction}
            onChange={(e) => setSystemInstruction(e.target.value)}
            rows={2}
            className="w-full rounded-lg bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:outline-none p-2.5 text-xs text-slate-200 resize-none"
          />
        </div>

        {/* Chat / Synthesis Stream */}
        <div className="flex-1 p-5 space-y-4 overflow-y-auto max-h-[440px]">
          {messages.map((msg) => {
            const targetBp = msg.targetBlueprintId ? bpMap.get(msg.targetBlueprintId) : null;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-3xl rounded-2xl p-4 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-950/90 border border-slate-800 text-slate-200'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>

                  {/* Round-Trip Structured Object Card + One-Click Save to Collection */}
                  {msg.generatedObject && targetBp && (
                    <div className="mt-4 pt-3 border-t border-slate-800 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
                          <BlueprintIcon name={targetBp.ui_config?.icon} className="w-4 h-4" />
                          Generated {targetBp.name} Payload
                        </span>

                        {msg.savedToCollection ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            <CheckCircle2 className="w-4 h-4" />
                            Saved to {targetBp.name}
                          </span>
                        ) : (
                          <button
                            onClick={() =>
                              handleRoundTripSave(
                                msg.id,
                                targetBp.id,
                                msg.generatedObject!
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow transition cursor-pointer"
                          >
                            <Database className="w-3.5 h-3.5" />
                            Save to Collection ({targetBp.name})
                          </button>
                        )}
                      </div>

                      <pre className="p-3 rounded-xl bg-slate-900 border border-slate-800 font-mono text-[11px] text-emerald-300 overflow-x-auto">
                        {JSON.stringify(msg.generatedObject, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 px-1">{msg.timestamp}</span>
              </div>
            );
          })}
        </div>

        {/* Bottom Prompt Bar & Round-Trip Structured Generation Controls */}
        <div className="p-4 bg-slate-950/90 border-t border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={enableRoundTripGeneration}
                onChange={(e) => setEnableRoundTripGeneration(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-500"
              />
              <span className="font-medium">
                Round-Trip Mode: Generate Schema-Locked Object for Collection
              </span>
            </label>

            {enableRoundTripGeneration && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Target Blueprint:</span>
                <select
                  value={roundTripBlueprintId}
                  onChange={(e) => setRoundTripBlueprintId(e.target.value)}
                  className="rounded-lg bg-slate-900 border border-indigo-500/40 px-2.5 py-1 text-xs text-indigo-200"
                >
                  {blueprints.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Quick Suggestion Prompts */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() =>
                handleRunQuery(
                  'Based on these RPG encounters and villains in the context payload, generate a new climactic encounter that connects Archivist Malakor and the Iron Syndicate.'
                )
              }
              className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 cursor-pointer"
            >
              <PlusCircle className="w-3 h-3 text-indigo-400" />
              Generate New Linked RPG Encounter
            </button>
            <button
              type="button"
              onClick={() => {
                setEnableRoundTripGeneration(false);
                handleRunQuery(
                  'Analyze all selected records in the context payload and summarize hidden patterns, shared dependencies, and key risks.'
                );
              }}
              className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 cursor-pointer"
            >
              <Sparkles className="w-3 h-3 text-emerald-400" />
              Synthesize Cross-Record Insights
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRunQuery();
              }}
              placeholder={
                enableRoundTripGeneration
                  ? 'Ask Gemini to generate a new item grounded in your active Context Payload...'
                  : 'Ask a question grounded strictly in the selected structured JSON records...'
              }
              className="flex-1 rounded-xl bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:outline-none px-4 py-2.5 text-xs text-white placeholder-slate-500"
            />
            <button
              onClick={() => handleRunQuery()}
              disabled={isExecuting || !userQuery.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white shadow-lg shadow-indigo-950/60 transition cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              {isExecuting ? 'Thinking...' : 'Execute'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
