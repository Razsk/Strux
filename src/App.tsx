import React, { useState, useEffect } from 'react';
import {
  Wand2,
  FileInput,
  Database,
  Sparkles,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Boxes,
  X,
  Terminal
} from 'lucide-react';
import type { Blueprint, SavedPrompt, StruxRecord } from './types';
import { api } from './api';
import { BlueprintIcon } from './components/BlueprintIcon';
import { SchemaArchitectView } from './components/SchemaArchitectView';
import { DataExtractorView } from './components/DataExtractorView';
import { CollectionManagerView } from './components/CollectionManagerView';
import { ContextStudioView } from './components/ContextStudioView';

type ActiveModule = 'architect' | 'ingest' | 'collections' | 'context';

export function App() {
  const [activeModule, setActiveModule] = useState<ActiveModule>('architect');
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [activeBlueprint, setActiveBlueprint] = useState<Blueprint | null>(null);
  const [records, setRecords] = useState<StruxRecord[]>([]);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [contextCartIds, setContextCartIds] = useState<Set<string>>(new Set());

  // API key & system prompt inspector modal
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>(
    localStorage.getItem('STRUX_GEMINI_API_KEY') || ''
  );
  const [systemPrompts, setSystemPrompts] = useState<{
    schemaArchitect: string;
    dataExtractor: string;
  } | null>(null);

  useEffect(() => {
    loadInitialState();
  }, []);

  async function loadInitialState() {
    try {
      const [status, bps, recs, prompts] = await Promise.all([
        api.getStatus(),
        api.getBlueprints(),
        api.getRecords(),
        api.getSavedPrompts()
      ]);
      setHasApiKey(status.hasApiKey);
      setSystemPrompts(status.systemPrompts);
      setBlueprints(bps);
      setRecords(recs);
      setSavedPrompts(prompts);
      if (bps.length > 0) {
        setActiveBlueprint(bps[0]);
      }
      // Pre-select the first 3 RPG records in Context Cart so Context Studio is immediately rich
      const rpgRecIds = recs
        .filter((r) => r.blueprint_id === 'bp-ttrpg-encounters')
        .map((r) => r.id);
      setContextCartIds(new Set(rpgRecIds));
    } catch (err) {
      console.error('Failed to load initial Strux state:', err);
    }
  }

  async function refreshBlueprints(selectBp?: Blueprint) {
    const bps = await api.getBlueprints();
    setBlueprints(bps);
    if (selectBp) {
      setActiveBlueprint(selectBp);
    } else if (activeBlueprint) {
      const updated = bps.find((b) => b.id === activeBlueprint.id) || bps[0] || null;
      setActiveBlueprint(updated);
    }
  }

  async function refreshRecords() {
    const [recs, bps] = await Promise.all([api.getRecords(), api.getBlueprints()]);
    setRecords(recs);
    setBlueprints(bps);
  }

  async function refreshSavedPrompts() {
    const prompts = await api.getSavedPrompts();
    setSavedPrompts(prompts);
  }

  function handleToggleContextCart(recordId: string) {
    setContextCartIds((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) {
        next.delete(recordId);
      } else {
        next.add(recordId);
      }
      return next;
    });
  }

  function handleAddMultipleToContextCart(recordIds: string[]) {
    setContextCartIds((prev) => {
      const next = new Set(prev);
      for (const id of recordIds) next.add(id);
      return next;
    });
  }

  function handleSelectAllForBlueprint(blueprintId: string) {
    const ids = records.filter((r) => r.blueprint_id === blueprintId).map((r) => r.id);
    handleAddMultipleToContextCart(ids);
  }

  async function handleSaveApiKey() {
    const res = await api.saveApiKey(apiKeyInput);
    setHasApiKey(res.hasApiKey);
    setShowSettingsModal(false);
  }

  const navItems: Array<{
    id: ActiveModule;
    label: string;
    stage: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    {
      id: 'architect',
      label: 'Blueprints & Schema',
      stage: 'Stage 1: Architect',
      icon: Wand2,
      badge: blueprints.length
    },
    {
      id: 'ingest',
      label: 'Ingest & Extractor',
      stage: 'Stage 2: Ingestion',
      icon: FileInput
    },
    {
      id: 'collections',
      label: 'Collections Manager',
      stage: 'Stage 3: Multi-View',
      icon: Database,
      badge: records.length
    },
    {
      id: 'context',
      label: 'Context Studio (RAG)',
      stage: 'Stage 4: LLM Context',
      icon: Sparkles,
      badge: contextCartIds.size
    }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col lg:flex-row">
      {/* Left Sidebar Navigation */}
      <aside className="w-full lg:w-72 bg-slate-900/95 border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col justify-between shrink-0">
        <div>
          {/* Brand Header */}
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-indigo-950/60">
                <Boxes className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold tracking-tight text-white">STRUX</span>
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    v1.0
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Structured Data & Context Manager
                </p>
              </div>
            </div>
          </div>

          {/* 4-Stage Lifecycle Navigation */}
          <nav className="p-3.5 space-y-1.5">
            <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              4-Stage Lifecycle Modules
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeModule === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveModule(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950/60'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-white' : 'text-indigo-400'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{item.label}</div>
                      <div
                        className={`text-[10px] truncate ${
                          isActive ? 'text-indigo-200' : 'text-slate-500'
                        }`}
                      >
                        {item.stage}
                      </div>
                    </div>
                  </div>
                  {item.badge !== undefined && (
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                        isActive
                          ? 'bg-indigo-800 text-indigo-100'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Active Blueprints Quick Switcher */}
          <div className="p-3.5 border-t border-slate-800/80">
            <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Active Blueprint Schemas
            </div>
            <div className="mt-1 space-y-1">
              {blueprints.map((bp) => {
                const isSelected = activeBlueprint?.id === bp.id;
                const recCount = records.filter((r) => r.blueprint_id === bp.id).length;
                return (
                  <button
                    key={bp.id}
                    onClick={() => {
                      setActiveBlueprint(bp);
                      if (activeModule === 'context') {
                        setActiveModule('collections');
                      }
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition cursor-pointer ${
                      isSelected
                        ? 'bg-slate-800 text-white border border-slate-700'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <BlueprintIcon
                        name={bp.ui_config?.icon}
                        className="w-3.5 h-3.5 text-indigo-400 shrink-0"
                      />
                      <span className="truncate">{bp.name}</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">{recCount}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Gemini Status & System Prompts Button */}
        <div className="p-4 border-t border-slate-800 space-y-2">
          <button
            onClick={() => setShowSettingsModal(true)}
            className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 transition cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <KeyRound
                className={`w-4 h-4 ${hasApiKey ? 'text-emerald-400' : 'text-amber-400'}`}
              />
              <div className="text-left">
                <div className="text-xs font-semibold text-white">
                  {hasApiKey ? 'Gemini 3.8 Flash Live' : 'Configure Gemini Key'}
                </div>
                <div className="text-[10px] text-slate-400">
                  {hasApiKey ? 'responseSchema Active' : 'Local Synthesis Active'}
                </div>
              </div>
            </div>
            {hasApiKey ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400" />
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="px-6 py-4 bg-slate-900/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              {activeModule === 'architect' && 'Module 1: The Schema Architect (Meta-Prompting)'}
              {activeModule === 'ingest' &&
                'Module 2: The Data Extractor (Unstructured → Structured JSON)'}
              {activeModule === 'collections' &&
                'Module 3: Collection Manager & Multi-View Display'}
              {activeModule === 'context' &&
                'Module 4: Context Studio (Querying with Structured Data)'}
            </h1>
            <p className="text-xs text-slate-400">
              {activeModule === 'architect' &&
                'Design Draft-07 / OpenAPI 3.0 JSON Schemas where every property description guides LLM extraction.'}
              {activeModule === 'ingest' &&
                'Transform raw transcripts, notes, and brain-dumps into strictly validated JSON collections.'}
              {activeModule === 'collections' &&
                'Inspect, filter, inline-edit, and select structured records across Card Grid, Spreadsheet Table, Master-Detail, and Raw JSON views.'}
              {activeModule === 'context' &&
                'Inject clean, high-density structured JSON payloads into Gemini with Round-Trip Collection Saving.'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSettingsModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
            >
              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
              System Prompts & API Key
            </button>
          </div>
        </header>

        {/* Active Module Workspace */}
        <main className="flex-1 p-6 overflow-y-auto">
          {activeModule === 'architect' && (
            <SchemaArchitectView
              blueprints={blueprints}
              activeBlueprint={activeBlueprint}
              onSelectBlueprint={(bp) => setActiveBlueprint(bp)}
              onBlueprintSaved={(saved) => refreshBlueprints(saved)}
              onBlueprintDeleted={async (id) => {
                await api.deleteBlueprint(id);
                refreshBlueprints();
                refreshRecords();
              }}
              onNavigateToExtractor={(bp) => {
                setActiveBlueprint(bp);
                setActiveModule('ingest');
              }}
            />
          )}

          {activeModule === 'ingest' && (
            <DataExtractorView
              blueprints={blueprints}
              activeBlueprint={activeBlueprint}
              onSelectBlueprint={(bp) => setActiveBlueprint(bp)}
              onBlueprintUpdated={(updated) => refreshBlueprints(updated)}
              onRecordsCommitted={async (bpId) => {
                await refreshRecords();
                const found = blueprints.find((b) => b.id === bpId);
                if (found) setActiveBlueprint(found);
                setActiveModule('collections');
              }}
            />
          )}

          {activeModule === 'collections' && (
            <CollectionManagerView
              blueprints={blueprints}
              activeBlueprint={activeBlueprint}
              onSelectBlueprint={(bp) => setActiveBlueprint(bp)}
              records={records}
              onRefreshRecords={refreshRecords}
              contextCartIds={contextCartIds}
              onToggleContextCart={handleToggleContextCart}
              onAddMultipleToContextCart={handleAddMultipleToContextCart}
              onNavigateToContextStudio={() => setActiveModule('context')}
            />
          )}

          {activeModule === 'context' && (
            <ContextStudioView
              blueprints={blueprints}
              records={records}
              savedPrompts={savedPrompts}
              onRefreshSavedPrompts={refreshSavedPrompts}
              onRefreshRecords={refreshRecords}
              contextCartIds={contextCartIds}
              onToggleContextCart={handleToggleContextCart}
              onClearContextCart={() => setContextCartIds(new Set())}
              onSelectAllForBlueprint={handleSelectAllForBlueprint}
            />
          )}
        </main>
      </div>

      {/* Settings & Embedded System Prompts Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <KeyRound className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-bold text-white">
                  Gemini API Configuration & Embedded System Prompts
                </h2>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                Google Gemini API Key (@google/genai — gemini-3.8-flash)
              </label>
              <p className="text-xs text-slate-400">
                Provide your Gemini API key to run live schema generation, strict{' '}
                <code className="text-indigo-300">responseSchema</code> extraction, and Context Studio queries. Stored locally in SQLite and browser storage.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="AIzaSy..."
                  className="flex-1 rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none px-3.5 py-2 text-xs font-mono text-white"
                />
                <button
                  onClick={handleSaveApiKey}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer"
                >
                  Save Key
                </button>
              </div>
            </div>

            {systemPrompts && (
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400 block mb-1">
                    Prompt A: Schema Architect System Prompt (SRD Section 5)
                  </span>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 font-mono leading-relaxed">
                    "{systemPrompts.schemaArchitect}"
                  </div>
                </div>
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 block mb-1">
                    Prompt B: Unstructured Data Extractor System Prompt (SRD Section 5)
                  </span>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 font-mono leading-relaxed">
                    "{systemPrompts.dataExtractor}"
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
