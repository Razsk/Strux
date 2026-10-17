import React, { useState, useRef } from 'react';
import {
  FileUp,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Database,
  Layers,
  FileText,
  Trash2,
  Code2,
  Eye,
  ArrowRight,
  ClipboardCopy,
  ClipboardPaste,
  Check
} from 'lucide-react';
import type { Blueprint, StagedExtractionItem } from '../types';
import { api } from '../api';
import { BlueprintIcon } from './BlueprintIcon';
import {
  buildChatbotDataExtractionPrompt,
  extractJsonFromClipboardText
} from '../utils/clipboardBridge';

interface DataExtractorViewProps {
  blueprints: Blueprint[];
  activeBlueprint: Blueprint | null;
  onSelectBlueprint: (bp: Blueprint) => void;
  onRecordsCommitted: (blueprintId: string, count: number) => void;
  onBlueprintUpdated?: (bp: Blueprint) => void;
}

const SAMPLE_UNSTRUCTURED_DUMPS: Record<string, { single: string; batch: string }> = {
  'bp-ttrpg-encounters': {
    single: `# Session 14 Brain-Dump: The Sunken Reliquary of Saint Vesper
Location: Flooded Catacombs beneath the Old Cathedral
Danger / Pacing: High intensity Investigation & Stealth
Primary NPC: Sister Meridia (Corrupted Oracle of the Tide)
Why she's doing it: She believes awakening the Leviathan embryo beneath the altar will purge the city's corrupt nobility.
Clues the party can find:
- Waterlogged prayer book with dates of high-tide kidnappings circled in red ink
- Brass diving bell key hidden inside the confessional booth grating
- Corroded silver chalice etched with the Iron Syndicate smuggling seal
Faction ties:
- Iron Syndicate -> Reluctant Smugglers (Supplied Meridia with alchemical mutagens)
- Cathedral Clergy -> Blind Deniers (Covering up the disappearances)
- Harbor Watch -> Bribed Lookouts (Ordered to ignore lights in the crypt)
Outcome/Loot: Tide-Caller's Lantern, 300 gold crowns, and proof of the Syndicate's involvement.`,
    batch: `Encounter 1: The Clockwork Auction at Velvet Alley
Taking place at the Subterranean Auction Hall in the Brass Ward. Moderate intensity Social Intrigue.
Broker: Master Artificer Gideon. He wants to auction off the stolen memory core of the Royal Automaton to the highest foreign bidder.
Clues:
- Encrypted bidding paddles tuned to guild frequencies
- A forged bill of sale signed by Magistrate Corvo
- Oil stains leading behind the velvet curtain to the holding vault
Relationships:
- Merchant Guilds -> Aggressive Bidders (Want military secrets)
- Royal Guard -> Infiltrators in Disguise (Waiting to raid the hall)

---

Encounter 2: Siege of the Sky-Beacon Tower
Location: Upper Spire Pinnacle during an arcane lightning storm. Deadly Tactical Combat.
Antagonist: Storm-Herald Kaelen & 4 Winged Gargoyles.
Motive: Overload the lightning rod array to shatter the city's protective ward-shield before the airship armada arrives.
Clues:
- Sabotaged copper grounding cables cut with arcane shears
- Signal flare code sheet matching the exiled fleet's frequencies
- Dead watchman clutching a badge from House Vane
Relationships:
- Exiled Fleet -> Vanguard Commander (Kaelen reports directly to Admiral Thorne)
- House Vane -> Inside Saboteurs (Disabled the tower elevator)`
  },
  'bp-server-nodes': {
    single: `Incident Handoff Note:
Node prod-llm-gateway-09.internal (IP 10.24.30.88) in us-east-1c is currently in Degraded state in Production.
Specs: 64 CPU cores, 256 GB RAM. Owned by the Inference Platform Squad.
Active services running: vllm-router, envoy-ingress, prometheus-exporter, rate-limiter-redis.
Notes: Experiencing intermittent CUDA out-of-memory spikes when handling 64k context requests. Needs tensor-parallel flag adjustment during tonight's maintenance window.`,
    batch: `Server Inventory Dump:
1. staging-postgres-primary-01.internal (10.24.90.12) located in eu-west-1a. Staging environment, Healthy status. 16 cores, 64GB RAM. Services: postgresql-16, pgbouncer, wal-g-archiver. Team: Core Storage.
---
2. prod-kafka-broker-03.internal (10.24.14.203) in eu-central-1c. Production tier, Critical status! 32 cores, 128GB RAM. Running kafka-broker, zookeeper-agent, node-exporter. Owned by Streaming Infra. Disk usage at 94% on /var/lib/kafka due to retention misconfiguration.`
  }
};

export function DataExtractorView({
  blueprints,
  activeBlueprint,
  onSelectBlueprint,
  onRecordsCommitted,
  onBlueprintUpdated
}: DataExtractorViewProps) {
  const selectedBp = activeBlueprint || blueprints[0] || null;
  const [rawText, setRawText] = useState('');
  const [mode, setMode] = useState<'single' | 'batch'>('batch');
  const [blueprintHint, setBlueprintHint] = useState(
    selectedBp?.extraction_prompt_template || ''
  );
  const [customInstructions, setCustomInstructions] = useState('');
  const [isSavingHint, setIsSavingHint] = useState(false);
  const [savedHintSuccess, setSavedHintSuccess] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  React.useEffect(() => {
    setBlueprintHint(selectedBp?.extraction_prompt_template || '');
    setSavedHintSuccess(false);
  }, [selectedBp?.id, selectedBp?.extraction_prompt_template]);

  async function handleSaveBlueprintHint() {
    if (!selectedBp) return;
    setIsSavingHint(true);
    try {
      const updated = await api.updateBlueprint(selectedBp.id, {
        extraction_prompt_template: blueprintHint.trim()
      });
      onBlueprintUpdated?.(updated);
      setSavedHintSuccess(true);
      setTimeout(() => setSavedHintSuccess(false), 3000);
    } finally {
      setIsSavingHint(false);
    }
  }
  const [isCommitting, setIsCommitting] = useState(false);
  const [stagedItems, setStagedItems] = useState<StagedExtractionItem[]>([]);
  const [jsonEditDrafts, setJsonEditDrafts] = useState<Record<string, string>>({});
  const [promptPreview, setPromptPreview] = useState<string>('');
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [banner, setBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  // External Chatbot Clipboard Bridge state
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [manualPasteDrawer, setManualPasteDrawer] = useState(false);
  const [manualPasteText, setManualPasteText] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleLoadSample(targetMode: 'single' | 'batch') {
    if (!selectedBp) return;
    setMode(targetMode);
    const preset = SAMPLE_UNSTRUCTURED_DUMPS[selectedBp.id];
    if (preset) {
      setRawText(targetMode === 'batch' ? preset.batch : preset.single);
    } else {
      setRawText(
        targetMode === 'batch'
          ? `Item 1: Primary note for ${selectedBp.name}\n- Important detail alpha\n- Key takeaway beta\n\n---\n\nItem 2: Secondary entry for ${selectedBp.name}\n- Follow-up metric\n- Actionable insight`
          : `Unstructured brain-dump for ${selectedBp.name}:\nPrimary subject: High-priority synthesis entry.\nDetails:\n- Key observation extracted from raw meeting transcript\n- Verified metric and follow-up requirement`
      );
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setRawText(reader.result);
      }
    };
    reader.readAsText(file);
  }

  function getTailoredChatbotPrompt(): string {
    if (!selectedBp) return '';
    return buildChatbotDataExtractionPrompt({
      blueprint: {
        ...selectedBp,
        extraction_prompt_template: blueprintHint.trim()
      },
      rawText,
      mode,
      customInstructions
    });
  }

  async function handleCopyChatbotPrompt() {
    if (!selectedBp) return;
    const fullPrompt = getTailoredChatbotPrompt();
    setPromptPreview(fullPrompt);
    try {
      await navigator.clipboard.writeText(fullPrompt);
      setCopiedPrompt(true);
      setBanner({
        type: 'success',
        text: `Tailored "${selectedBp.name}" extraction prompt written to your clipboard! Paste it into your chatbot, copy the JSON output, then click "2. Read & Parse Output from Clipboard".`
      });
      setTimeout(() => setCopiedPrompt(false), 3500);
    } catch (err: any) {
      setShowPromptModal(true);
      setBanner({
        type: 'warning',
        text: `Browser blocked direct clipboard write (${err.message}). Expanded tailored prompt on the right so you can copy it manually.`
      });
    }
  }

  async function processExtractedClipboardText(clipText: string) {
    if (!selectedBp) return;
    const parsed = extractJsonFromClipboardText(clipText);
    const rawArray: Record<string, any>[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.items)
      ? parsed.items
      : [parsed];

    if (rawArray.length === 0) {
      throw new Error('Parsed JSON array is empty.');
    }

    const validatedList: StagedExtractionItem[] = await Promise.all(
      rawArray.map(async (obj, idx) => {
        const validation = await api.validateRecord(selectedBp.id, obj);
        return {
          tempId: `clip-${Date.now()}-${idx}`,
          data: obj,
          raw_source: rawText.trim() || 'Extracted via External Chatbot Clipboard Bridge',
          isValid: validation.isValid,
          validationErrors: validation.validationErrors,
          selected: true
        };
      })
    );

    const drafts: Record<string, string> = {};
    for (const s of validatedList) {
      drafts[s.tempId] = JSON.stringify(s.data, null, 2);
    }

    setStagedItems(validatedList);
    setJsonEditDrafts(drafts);
    setManualPasteDrawer(false);
    setManualPasteText('');

    const validCount = validatedList.filter((i) => i.isValid).length;
    setBanner({
      type: validCount === validatedList.length ? 'success' : 'warning',
      text: `Parsed ${validatedList.length} JSON object(s) from clipboard (${validCount} schema-valid)! Review in the Staging Inspector below and click Commit.`
    });
  }

  async function handleReadExtractionFromClipboard() {
    try {
      const clipText = await navigator.clipboard.readText();
      await processExtractedClipboardText(clipText);
    } catch (err: any) {
      setManualPasteDrawer(true);
      setBanner({
        type: 'error',
        text: `${err.message || 'Could not read clipboard.'} You can also paste the chatbot JSON reply in the manual box below.`
      });
    }
  }

  async function handleRunExtractor() {
    if (!selectedBp || !rawText.trim()) return;
    setIsExtracting(true);
    setBanner(null);

    try {
      const result = await api.extractData({
        blueprint_id: selectedBp.id,
        raw_text: rawText,
        mode,
        custom_instructions: customInstructions.trim() || undefined
      });

      const staged: StagedExtractionItem[] = result.items.map((item, idx) => {
        const tempId = `staged-${Date.now()}-${idx}`;
        return {
          tempId,
          data: item.data,
          raw_source: item.raw_source,
          isValid: item.isValid,
          validationErrors: item.validationErrors,
          selected: true
        };
      });

      const drafts: Record<string, string> = {};
      for (const s of staged) {
        drafts[s.tempId] = JSON.stringify(s.data, null, 2);
      }

      setStagedItems(staged);
      setJsonEditDrafts(drafts);
      setPromptPreview(result.promptUsed);
      setBanner({
        type: result.simulated ? 'warning' : 'success',
        text: result.simulated
          ? `Extracted ${staged.length} structured JSON object(s) using local schema-locked parser (or use the Chatbot Clipboard Bridge on the left). Review in the Staging Inspector below.`
          : `Extracted ${staged.length} schema-validated JSON object(s) via Gemini 3.8 Flash responseSchema!`
      });
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Extraction failed.'
      });
    } finally {
      setIsExtracting(false);
    }
  }

  async function handleStageJsonChange(tempId: string, newJsonText: string) {
    setJsonEditDrafts((prev) => ({ ...prev, [tempId]: newJsonText }));
    if (!selectedBp) return;

    try {
      const parsed = JSON.parse(newJsonText);
      const validation = await api.validateRecord(selectedBp.id, parsed);
      setStagedItems((prev) =>
        prev.map((item) =>
          item.tempId === tempId
            ? {
                ...item,
                data: parsed,
                isValid: validation.isValid,
                validationErrors: validation.validationErrors
              }
            : item
        )
      );
    } catch (err: any) {
      setStagedItems((prev) =>
        prev.map((item) =>
          item.tempId === tempId
            ? {
                ...item,
                isValid: false,
                validationErrors: [`Invalid JSON syntax: ${err.message}`]
              }
            : item
        )
      );
    }
  }

  async function handleCommitSelected() {
    if (!selectedBp) return;
    const toCommit = stagedItems.filter((i) => i.selected && i.isValid);
    if (toCommit.length === 0) return;

    setIsCommitting(true);
    try {
      await api.createRecordsBatch(
        selectedBp.id,
        toCommit.map((i) => ({
          data: i.data,
          raw_source: i.raw_source
        }))
      );
      setStagedItems([]);
      onRecordsCommitted(selectedBp.id, toCommit.length);
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Failed to commit records.'
      });
    } finally {
      setIsCommitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      {/* Left Column: Unstructured Input & Prompt Engine Config */}
      <div className="xl:col-span-5 space-y-5">
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">
                Unstructured Data Ingestion
              </h2>
              <p className="text-xs text-slate-400">
                Lock extraction to an active Blueprint JSON Schema
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.json,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
            >
              <FileUp className="w-3.5 h-3.5 text-indigo-400" />
              Upload .txt / .md
            </button>
          </div>

          {/* Blueprint Selector */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Active Target Blueprint
            </label>
            <div className="grid grid-cols-1 gap-2">
              <select
                value={selectedBp?.id || ''}
                onChange={(e) => {
                  const found = blueprints.find((b) => b.id === e.target.value);
                  if (found) onSelectBlueprint(found);
                }}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none px-3 py-2.5 text-sm text-white"
              >
                {blueprints.map((bp) => (
                  <option key={bp.id} value={bp.id}>
                    {bp.name} (v{bp.ui_config?.version || '1.0'} —{' '}
                    {Object.keys(bp.json_schema?.properties || {}).length} fields)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Extraction Mode Toggle: Single vs Batch */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Extraction Mode (responseSchema)
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800">
              <button
                type="button"
                onClick={() => setMode('single')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition cursor-pointer ${
                  mode === 'single'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                Single Object (1 Note → 1 JSON)
              </button>
              <button
                type="button"
                onClick={() => setMode('batch')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition cursor-pointer ${
                  mode === 'batch'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Batch Array (Doc → JSON[])
              </button>
            </div>
          </div>

          {/* Raw Unstructured Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Raw Unstructured Notes / Transcript
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleLoadSample('single')}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
                >
                  Load Single Sample
                </button>
                <span className="text-slate-700">•</span>
                <button
                  type="button"
                  onClick={() => handleLoadSample('batch')}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 cursor-pointer"
                >
                  Load Batch Sample
                </button>
              </div>
            </div>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={8}
              placeholder="Paste messy notes, meeting transcripts, markdown brain-dumps, or log snippets here..."
              className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none p-3.5 text-xs text-slate-100 placeholder-slate-500 leading-relaxed"
            />
          </div>

          {/* Blueprint-Specific Prompt Hints & Domain Rules */}
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-indigo-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-indigo-300">
                Blueprint-Specific Prompt Hints ({selectedBp?.name})
              </label>
              <button
                type="button"
                onClick={handleSaveBlueprintHint}
                disabled={
                  isSavingHint ||
                  !selectedBp ||
                  blueprintHint.trim() === (selectedBp.extraction_prompt_template || '').trim()
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-indigo-600/30 hover:bg-indigo-600/50 disabled:opacity-40 text-indigo-200 border border-indigo-500/40 transition cursor-pointer"
              >
                {savedHintSuccess ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" /> Saved to Blueprint
                  </>
                ) : (
                  <>
                    <Database className="w-3 h-3" /> Save Hint to Blueprint
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Domain-specific parsing hints saved directly on this Blueprint and injected into every extraction prompt (e.g., splitting <code className="text-indigo-300">"Saga of the Iron Dragon #5"</code> into series name + book number).
            </p>
            <textarea
              rows={3}
              value={blueprintHint}
              onChange={(e) => setBlueprintHint(e.target.value)}
              placeholder="e.g., If a series name contains a number (like 'Saga of the Iron Dragon #5'), strip the number from 'series' and place the numeric book index in 'series_number'."
              className="w-full rounded-lg bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:outline-none p-2.5 text-xs text-slate-100 leading-relaxed"
            />

            <div className="pt-1">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                One-Off Run Override (Optional)
              </label>
              <input
                type="text"
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="Optional extra hint just for this paste..."
                className="w-full rounded-lg bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:outline-none px-2.5 py-1.5 text-xs text-slate-200"
              />
            </div>
          </div>

          <button
            onClick={handleRunExtractor}
            disabled={isExtracting || !rawText.trim() || !selectedBp}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white shadow-lg shadow-indigo-950/60 transition cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            {isExtracting
              ? 'Running Schema-Locked Extraction...'
              : `Extract via API into ${selectedBp?.name || 'Blueprint'}`}
          </button>

          {/* Chatbot Clipboard Bridge for Unstructured Data Extraction */}
          <div className="p-4 rounded-xl bg-slate-950/90 border border-emerald-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                Chatbot Clipboard Bridge (Prompt → Parse JSON)
              </span>
              <button
                type="button"
                onClick={() => {
                  setPromptPreview(getTailoredChatbotPrompt());
                  setShowPromptModal(!showPromptModal);
                }}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <Eye className="w-3 h-3" />
                {showPromptModal ? 'Hide Prompt' : 'Preview Prompt'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Generate a tailored extraction prompt containing your schema, field descriptions, and raw text directly to your clipboard. Paste into any chatbot, copy its JSON response, and read it back in one click.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCopyChatbotPrompt}
                disabled={!selectedBp}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-indigo-200 border border-indigo-500/40 transition cursor-pointer"
              >
                {copiedPrompt ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Copied to Clipboard!
                  </>
                ) : (
                  <>
                    <ClipboardCopy className="w-3.5 h-3.5 text-indigo-400" />
                    1. Copy Tailored Prompt
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleReadExtractionFromClipboard}
                disabled={!selectedBp}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200 border border-emerald-500/40 transition cursor-pointer"
              >
                <ClipboardPaste className="w-3.5 h-3.5 text-emerald-400" />
                2. Read & Parse Clipboard
              </button>
            </div>

            {manualPasteDrawer && (
              <div className="pt-2 space-y-2 border-t border-slate-800">
                <span className="text-[11px] text-amber-300 block">
                  Paste Chatbot JSON Output Manually:
                </span>
                <textarea
                  value={manualPasteText}
                  onChange={(e) => setManualPasteText(e.target.value)}
                  rows={4}
                  placeholder="Paste the chatbot JSON response here..."
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 p-2.5 font-mono text-xs text-emerald-300"
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
                    onClick={async () => {
                      try {
                        await processExtractedClipboardText(manualPasteText);
                      } catch (e: any) {
                        setBanner({ type: 'error', text: e.message });
                      }
                    }}
                    className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                  >
                    Parse Pasted JSON
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Column: Staging Review & Diff Inspector UI */}
      <div className="xl:col-span-7 space-y-5">
        {banner && (
          <div
            className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs ${
              banner.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                : banner.type === 'warning'
                ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
            }`}
          >
            <span>{banner.text}</span>
            {promptPreview && (
              <button
                onClick={() => setShowPromptModal(!showPromptModal)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700 shrink-0 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                {showPromptModal ? 'Hide Prompt' : 'Inspect Prompt'}
              </button>
            )}
          </div>
        )}

        {showPromptModal && (promptPreview || selectedBp) && (
          <div className="bg-slate-900 border border-indigo-500/40 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
                Tailored Extraction Prompt (Ready for Chatbot or API)
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCopyChatbotPrompt}
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer"
                >
                  Copy to Clipboard
                </button>
                <button
                  onClick={() => setShowPromptModal(false)}
                  className="text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
            <pre className="p-3 rounded-lg bg-slate-950 text-[11px] font-mono text-slate-300 whitespace-pre-wrap max-h-64 overflow-y-auto border border-slate-800">
              {promptPreview || getTailoredChatbotPrompt()}
            </pre>
          </div>
        )}

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <Code2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">
                  Staging Review & Validation Diff
                </h3>
                <p className="text-xs text-slate-400">
                  Inspect, edit, and schema-validate extracted JSON objects before committing to SQLite
                </p>
              </div>
            </div>

            {stagedItems.length > 0 && (
              <button
                onClick={handleCommitSelected}
                disabled={
                  isCommitting ||
                  stagedItems.filter((i) => i.selected && i.isValid).length === 0
                }
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white shadow-md transition cursor-pointer"
              >
                <Database className="w-3.5 h-3.5" />
                {isCommitting
                  ? 'Committing...'
                  : `Commit ${
                      stagedItems.filter((i) => i.selected && i.isValid).length
                    } Valid Record(s) to Collection`}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {stagedItems.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
                <BlueprintIcon name={selectedBp?.ui_config?.icon} className="w-6 h-6" />
              </div>
              <div className="max-w-md mx-auto">
                <h4 className="text-sm font-medium text-slate-200">
                  No Extracted Objects in Staging Yet
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  Paste messy text on the left, then either click <strong>Extract via API</strong> or use the <strong>Chatbot Clipboard Bridge</strong> (<em>1. Copy Tailored Prompt</em> → paste into your chatbot → <em>2. Read & Parse Clipboard</em>).
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {stagedItems.map((item, idx) => (
                <div
                  key={item.tempId}
                  className={`rounded-xl border p-4 transition ${
                    item.isValid
                      ? 'bg-slate-950/70 border-slate-800'
                      : 'bg-rose-950/20 border-rose-500/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={(e) =>
                          setStagedItems((prev) =>
                            prev.map((p) =>
                              p.tempId === item.tempId ? { ...p, selected: e.target.checked } : p
                            )
                          )
                        }
                        className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                      />
                      <span className="text-xs font-semibold text-white">
                        Staged Object #{idx + 1}:{' '}
                        <span className="text-indigo-300">
                          {String(
                            item.data[selectedBp?.ui_config?.primaryField || 'title'] ||
                              Object.values(item.data)[0] ||
                              'Record'
                          )}
                        </span>
                      </span>
                      {item.isValid ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3" /> Schema Valid
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/20 text-rose-300 border border-rose-500/40">
                          <AlertTriangle className="w-3 h-3" /> Validation Error
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() =>
                        setStagedItems((prev) => prev.filter((p) => p.tempId !== item.tempId))
                      }
                      className="p-1 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                      title="Discard staged object"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {!item.isValid && item.validationErrors.length > 0 && (
                    <div className="mb-3 p-2.5 rounded-lg bg-rose-950/60 border border-rose-500/40 text-[11px] font-mono text-rose-200 space-y-1">
                      {item.validationErrors.map((err, i) => (
                        <div key={i}>• {err}</div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                    <div className="lg:col-span-5 flex flex-col">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                        Source Text Reference
                      </span>
                      <div className="flex-1 p-3 rounded-lg bg-slate-900/90 border border-slate-800/80 text-xs text-slate-400 whitespace-pre-wrap max-h-60 overflow-y-auto">
                        {item.raw_source}
                      </div>
                    </div>
                    <div className="lg:col-span-7 flex flex-col">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                        Editable Structured JSON Payload (Live Schema Check)
                      </span>
                      <textarea
                        value={jsonEditDrafts[item.tempId] ?? JSON.stringify(item.data, null, 2)}
                        onChange={(e) => handleStageJsonChange(item.tempId, e.target.value)}
                        rows={9}
                        className="w-full rounded-lg bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:outline-none p-3 font-mono text-xs text-emerald-300"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
