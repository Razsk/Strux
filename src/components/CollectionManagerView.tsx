import React, { useState, useMemo, useRef } from 'react';
import {
  LayoutGrid,
  Table2,
  Columns3,
  Code2,
  Search,
  Filter,
  Plus,
  Trash2,
  Download,
  Upload,
  CheckSquare,
  Square,
  ArrowUpDown,
  Save,
  CheckCircle2,
  AlertTriangle,
  Sparkles
} from 'lucide-react';
import type { Blueprint, StruxRecord } from '../types';
import { api } from '../api';
import { BlueprintIcon } from './BlueprintIcon';

interface CollectionManagerViewProps {
  blueprints: Blueprint[];
  activeBlueprint: Blueprint | null;
  onSelectBlueprint: (bp: Blueprint) => void;
  records: StruxRecord[];
  onRefreshRecords: () => void;
  contextCartIds: Set<string>;
  onToggleContextCart: (recordId: string) => void;
  onAddMultipleToContextCart: (recordIds: string[]) => void;
  onNavigateToContextStudio: () => void;
}

type LayoutMode = 'cards' | 'table' | 'master-detail' | 'json';

export function CollectionManagerView({
  blueprints,
  activeBlueprint,
  onSelectBlueprint,
  records,
  onRefreshRecords,
  contextCartIds,
  onToggleContextCart,
  onAddMultipleToContextCart,
  onNavigateToContextStudio
}: CollectionManagerViewProps) {
  const selectedBp = activeBlueprint || blueprints[0] || null;
  const [layout, setLayout] = useState<LayoutMode>('cards');
  const [searchQuery, setSearchQuery] = useState('');
  const [enumFilterKey, setEnumFilterKey] = useState<string>('');
  const [enumFilterValue, setEnumFilterValue] = useState<string>('');
  const [sortField, setSortField] = useState<string>('');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  // Inline table cell edit state
  const [editingCell, setEditingCell] = useState<{
    recordId: string;
    fieldKey: string;
    value: string;
  } | null>(null);

  // JSON Inspector live editor state
  const [inspectorRecordId, setInspectorRecordId] = useState<string | null>(null);
  const [inspectorText, setInspectorText] = useState<string>('');
  const [inspectorValid, setInspectorValid] = useState<boolean>(true);
  const [inspectorErrors, setInspectorErrors] = useState<string[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);

  const bpRecords = useMemo(() => {
    if (!selectedBp) return [];
    return records.filter((r) => r.blueprint_id === selectedBp.id);
  }, [records, selectedBp?.id]);

  const schemaKeys = useMemo(() => {
    if (!selectedBp) return [];
    return Object.keys(selectedBp.json_schema?.properties || {});
  }, [selectedBp]);

  const enumFields = useMemo(() => {
    if (!selectedBp) return [];
    return Object.entries(selectedBp.json_schema?.properties || {})
      .filter(([, p]) => p.enum && p.enum.length > 0)
      .map(([k, p]) => ({ key: k, values: p.enum! }));
  }, [selectedBp]);

  const filteredRecords = useMemo(() => {
    let list = [...bpRecords];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) => JSON.stringify(r.data).toLowerCase().includes(q));
    }

    if (enumFilterKey && enumFilterValue) {
      list = list.filter((r) => String(r.data[enumFilterKey]) === enumFilterValue);
    }

    if (sortField) {
      list.sort((a, b) => {
        const va = a.data[sortField] ?? '';
        const vb = b.data[sortField] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') {
          return sortAsc ? va - vb : vb - va;
        }
        return sortAsc
          ? String(va).localeCompare(String(vb))
          : String(vb).localeCompare(String(va));
      });
    }

    return list;
  }, [bpRecords, searchQuery, enumFilterKey, enumFilterValue, sortField, sortAsc]);

  const activeDetailRecord = useMemo(() => {
    return (
      filteredRecords.find((r) => r.id === selectedRecordId) ||
      filteredRecords[0] ||
      null
    );
  }, [filteredRecords, selectedRecordId]);

  function openInJsonInspector(rec: StruxRecord) {
    setInspectorRecordId(rec.id);
    setInspectorText(JSON.stringify(rec.data, null, 2));
    setInspectorValid(true);
    setInspectorErrors([]);
    setLayout('json');
  }

  async function handleInspectorChange(newText: string) {
    setInspectorText(newText);
    if (!selectedBp) return;
    try {
      const parsed = JSON.parse(newText);
      const res = await api.validateRecord(selectedBp.id, parsed);
      setInspectorValid(res.isValid);
      setInspectorErrors(res.validationErrors);
    } catch (err: any) {
      setInspectorValid(false);
      setInspectorErrors([`JSON Syntax Error: ${err.message}`]);
    }
  }

  async function handleSaveInspectorRecord() {
    if (!inspectorRecordId || !inspectorValid) return;
    const parsed = JSON.parse(inspectorText);
    await api.updateRecord(inspectorRecordId, parsed);
    onRefreshRecords();
    setStatusMsg('Saved record changes via JSON Inspector.');
    setTimeout(() => setStatusMsg(null), 3000);
  }

  async function handleCreateBlankRecord() {
    if (!selectedBp) return;
    const defaultObj: Record<string, any> = {};
    for (const [k, prop] of Object.entries(selectedBp.json_schema.properties || {})) {
      if (prop.enum && prop.enum.length > 0) {
        defaultObj[k] = prop.enum[0];
      } else if (prop.type === 'string') {
        defaultObj[k] = k === selectedBp.ui_config?.primaryField ? `New ${selectedBp.name} Item` : '';
      } else if (prop.type === 'integer' || prop.type === 'number') {
        defaultObj[k] = 0;
      } else if (prop.type === 'boolean') {
        defaultObj[k] = false;
      } else if (prop.type === 'array') {
        defaultObj[k] = [];
      }
    }
    const created = await api.createRecord(selectedBp.id, defaultObj, 'Created manually in Collection Manager');
    onRefreshRecords();
    openInJsonInspector(created);
  }

  async function handleCommitInlineCell() {
    if (!editingCell || !selectedBp) return;
    const targetRec = bpRecords.find((r) => r.id === editingCell.recordId);
    if (!targetRec) {
      setEditingCell(null);
      return;
    }

    const propDef = selectedBp.json_schema.properties[editingCell.fieldKey];
    let coercedValue: any = editingCell.value;
    if (propDef?.type === 'number' || propDef?.type === 'integer') {
      coercedValue = Number(editingCell.value) || 0;
    } else if (propDef?.type === 'boolean') {
      coercedValue = editingCell.value === 'true';
    } else if (propDef?.type === 'array') {
      coercedValue = editingCell.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const updatedData = {
      ...targetRec.data,
      [editingCell.fieldKey]: coercedValue
    };

    await api.updateRecord(targetRec.id, updatedData);
    setEditingCell(null);
    onRefreshRecords();
  }

  function handleExport(format: 'json' | 'csv') {
    if (!selectedBp || filteredRecords.length === 0) return;
    const filenameBase = selectedBp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    if (format === 'json') {
      const payload = JSON.stringify(
        filteredRecords.map((r) => r.data),
        null,
        2
      );
      downloadBlob(payload, `${filenameBase}.json`, 'application/json');
      return;
    }

    // CSV export
    const headers = schemaKeys;
    const csvRows = [
      headers.join(','),
      ...filteredRecords.map((r) =>
        headers
          .map((k) => {
            const val = r.data[k];
            const str = Array.isArray(val) ? val.join('; ') : String(val ?? '');
            return `"${str.replace(/"/g, '""')}"`;
          })
          .join(',')
      )
    ];
    downloadBlob(csvRows.join('\n'), `${filenameBase}.csv`, 'text/csv');
  }

  function downloadBlob(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedBp) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = String(reader.result || '');
        let objects: Record<string, any>[] = [];

        if (file.name.endsWith('.csv')) {
          const lines = text.split(/\r?\n/).filter((l) => l.trim());
          if (lines.length >= 2) {
            const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
            objects = lines.slice(1).map((line) => {
              const cols = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
              const obj: Record<string, any> = {};
              headers.forEach((h, i) => {
                const prop = selectedBp.json_schema.properties[h];
                const rawVal = cols[i] || '';
                if (prop?.type === 'array') {
                  obj[h] = rawVal.split(';').map((s) => s.trim()).filter(Boolean);
                } else if (prop?.type === 'number' || prop?.type === 'integer') {
                  obj[h] = Number(rawVal) || 0;
                } else {
                  obj[h] = rawVal;
                }
              });
              return obj;
            });
          }
        } else {
          const parsed = JSON.parse(text);
          objects = Array.isArray(parsed) ? parsed : [parsed];
        }

        if (objects.length > 0) {
          await api.createRecordsBatch(
            selectedBp.id,
            objects.map((o) => ({ data: o, raw_source: `Imported from ${file.name}` }))
          );
          onRefreshRecords();
          setStatusMsg(`Imported ${objects.length} record(s) from ${file.name}`);
          setTimeout(() => setStatusMsg(null), 4000);
        }
      } catch (err: any) {
        alert(`Import failed: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  const primaryKey = selectedBp?.ui_config?.primaryField || schemaKeys[0] || 'title';
  const subtitleKey = selectedBp?.ui_config?.subtitleField || schemaKeys[1] || '';
  const badgeKeys = selectedBp?.ui_config?.badgeFields || [];

  return (
    <div className="space-y-5">
      {/* Top Collection Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Collection Switcher Pills */}
          {blueprints.map((bp) => {
            const active = bp.id === selectedBp?.id;
            const count = records.filter((r) => r.blueprint_id === bp.id).length;
            return (
              <button
                key={bp.id}
                onClick={() => {
                  onSelectBlueprint(bp);
                  setEnumFilterKey('');
                  setEnumFilterValue('');
                  setInspectorRecordId(null);
                }}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border transition cursor-pointer ${
                  active
                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-950/50'
                    : 'bg-slate-950/80 text-slate-300 border-slate-800 hover:border-slate-700'
                }`}
              >
                <BlueprintIcon name={bp.ui_config?.icon} className="w-4 h-4" />
                <span>{bp.name}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                    active ? 'bg-indigo-800 text-indigo-100' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Multi-View Switcher (Grid, Table, Master-Detail, JSON Inspector) */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800">
            <button
              onClick={() => setLayout('cards')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                layout === 'cards'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Card Grid
            </button>
            <button
              onClick={() => setLayout('table')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                layout === 'table'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              Table View
            </button>
            <button
              onClick={() => setLayout('master-detail')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                layout === 'master-detail'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Columns3 className="w-3.5 h-3.5" />
              Master-Detail
            </button>
            <button
              onClick={() => {
                if (!inspectorRecordId && filteredRecords[0]) {
                  openInJsonInspector(filteredRecords[0]);
                } else {
                  setLayout('json');
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                layout === 'json'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              JSON Inspector
            </button>
          </div>
        </div>
      </div>

      {/* Filter, Search, Import/Export & Context Cart Toolbar */}
      <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search all fields in ${selectedBp?.name || 'collection'}...`}
              className="w-full rounded-lg bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500"
            />
          </div>

          {enumFields.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={enumFilterKey}
                onChange={(e) => {
                  setEnumFilterKey(e.target.value);
                  setEnumFilterValue('');
                }}
                className="rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs text-slate-200"
              >
                <option value="">Filter by Enum/Tag...</option>
                {enumFields.map((ef) => (
                  <option key={ef.key} value={ef.key}>
                    {ef.key}
                  </option>
                ))}
              </select>

              {enumFilterKey && (
                <select
                  value={enumFilterValue}
                  onChange={(e) => setEnumFilterValue(e.target.value)}
                  className="rounded-lg bg-slate-950 border border-indigo-500/50 px-2.5 py-1.5 text-xs text-indigo-300"
                >
                  <option value="">All Values</option>
                  {enumFields
                    .find((e) => e.key === enumFilterKey)
                    ?.values.map((val) => (
                      <option key={val} value={val}>
                        {val}
                      </option>
                    ))}
                </select>
              )}
            </div>
          )}
        </div>

        {/* Maintenance & Context Cart Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onAddMultipleToContextCart(filteredRecords.map((r) => r.id))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 transition cursor-pointer"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            Select View for Context ({filteredRecords.length})
          </button>

          {contextCartIds.size > 0 && (
            <button
              onClick={onNavigateToContextStudio}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow transition cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Query {contextCartIds.size} in Context Studio
            </button>
          )}

          <button
            onClick={handleCreateBlankRecord}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            New Record
          </button>

          <input
            ref={importInputRef}
            type="file"
            accept=".json,.csv"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer"
            title="Import JSON or CSV"
          >
            <Upload className="w-3.5 h-3.5" />
            Import
          </button>

          <button
            onClick={() => handleExport('json')}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            .JSON
          </button>
          <button
            onClick={() => handleExport('csv')}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            .CSV
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="px-4 py-2.5 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          {statusMsg}
        </div>
      )}

      {/* VIEW 1: GRID / CARD VIEW */}
      {layout === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredRecords.map((rec) => {
            const inCart = contextCartIds.has(rec.id);
            const titleVal = String(rec.data[primaryKey] || 'Untitled Record');
            const subVal = subtitleKey ? String(rec.data[subtitleKey] || '') : '';
            const otherKeys = schemaKeys.filter(
              (k) => k !== primaryKey && k !== subtitleKey && !badgeKeys.includes(k)
            );

            return (
              <div
                key={rec.id}
                className={`rounded-xl border p-5 flex flex-col justify-between transition shadow-lg ${
                  inCart
                    ? 'bg-indigo-950/30 border-indigo-500/70'
                    : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div>
                  {/* Card Top Bar */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex flex-wrap gap-1.5">
                      {badgeKeys.map((bk) => {
                        const val = rec.data[bk];
                        if (!val) return null;
                        return (
                          <span
                            key={bk}
                            className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                          >
                            {String(val)}
                          </span>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onToggleContextCart(rec.id)}
                        title="Add/Remove from Context Studio Payload"
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition cursor-pointer ${
                          inCart
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                        }`}
                      >
                        {inCart ? (
                          <CheckSquare className="w-3.5 h-3.5" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                        Context
                      </button>
                    </div>
                  </div>

                  {/* Primary Title & Subtitle */}
                  <h3 className="text-base font-semibold text-white leading-snug">{titleVal}</h3>
                  {subVal && <p className="text-xs text-indigo-300/90 mt-0.5 font-medium">{subVal}</p>}

                  {/* Body Fields */}
                  <div className="mt-4 space-y-2.5 border-t border-slate-800/80 pt-3">
                    {otherKeys.slice(0, 5).map((k) => {
                      const val = rec.data[k];
                      if (val === undefined || val === null || val === '') return null;
                      return (
                        <div key={k} className="text-xs">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block">
                            {k}
                          </span>
                          {Array.isArray(val) ? (
                            <ul className="mt-1 space-y-1">
                              {val.map((item, idx) => (
                                <li
                                  key={idx}
                                  className="text-slate-300 pl-2.5 border-l-2 border-slate-700 text-[11px]"
                                >
                                  {String(item)}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-slate-200 line-clamp-3 mt-0.5">{String(val)}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="mt-4 pt-3 border-t border-slate-800/70 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono text-[10px]">ID: {rec.id.slice(0, 8)}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openInJsonInspector(rec)}
                      className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                    >
                      Edit JSON
                    </button>
                    <button
                      onClick={async () => {
                        await api.deleteRecord(rec.id);
                        onRefreshRecords();
                      }}
                      className="text-slate-500 hover:text-rose-400 cursor-pointer"
                      title="Delete record"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW 2: SPREADSHEET / TABLE VIEW WITH INLINE CELL EDITING */}
      {layout === 'table' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="px-4 py-2.5 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>
              Click any column header to sort • <strong>Double-click any cell</strong> to edit inline
            </span>
            <span>{filteredRecords.length} rows</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-3 w-10 text-center">Ctx</th>
                  {schemaKeys.map((key) => (
                    <th
                      key={key}
                      onClick={() => {
                        if (sortField === key) {
                          setSortAsc(!sortAsc);
                        } else {
                          setSortField(key);
                          setSortAsc(true);
                        }
                      }}
                      className="py-3 px-3 cursor-pointer hover:text-white select-none whitespace-nowrap"
                    >
                      <div className="inline-flex items-center gap-1">
                        <span>{key}</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-600" />
                      </div>
                    </th>
                  ))}
                  <th className="py-3 px-3 w-20 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {filteredRecords.map((rec) => {
                  const inCart = contextCartIds.has(rec.id);
                  return (
                    <tr
                      key={rec.id}
                      className={`transition ${
                        inCart ? 'bg-indigo-950/30' : 'hover:bg-slate-900/60'
                      }`}
                    >
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={inCart}
                          onChange={() => onToggleContextCart(rec.id)}
                          className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                        />
                      </td>
                      {schemaKeys.map((k) => {
                        const rawVal = rec.data[k];
                        const isEditing =
                          editingCell?.recordId === rec.id && editingCell?.fieldKey === k;
                        const displayStr = Array.isArray(rawVal)
                          ? rawVal.join(', ')
                          : String(rawVal ?? '');

                        return (
                          <td
                            key={k}
                            onDoubleClick={() =>
                              setEditingCell({
                                recordId: rec.id,
                                fieldKey: k,
                                value: displayStr
                              })
                            }
                            className="p-2.5 max-w-xs align-top cursor-text"
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                type="text"
                                value={editingCell.value}
                                onChange={(e) =>
                                  setEditingCell({ ...editingCell, value: e.target.value })
                                }
                                onBlur={handleCommitInlineCell}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleCommitInlineCell();
                                  if (e.key === 'Escape') setEditingCell(null);
                                }}
                                className="w-full bg-slate-950 border border-indigo-500 rounded px-2 py-1 text-xs text-white focus:outline-none"
                              />
                            ) : Array.isArray(rawVal) ? (
                              <div className="flex flex-wrap gap-1">
                                {rawVal.slice(0, 3).map((tag, i) => (
                                  <span
                                    key={i}
                                    className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px] truncate max-w-[180px]"
                                  >
                                    {String(tag)}
                                  </span>
                                ))}
                                {rawVal.length > 3 && (
                                  <span className="text-[10px] text-slate-500">
                                    +{rawVal.length - 3}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-200 line-clamp-2">{displayStr}</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => openInJsonInspector(rec)}
                          className="text-indigo-400 hover:text-indigo-300 mr-2 cursor-pointer"
                        >
                          JSON
                        </button>
                        <button
                          onClick={async () => {
                            await api.deleteRecord(rec.id);
                            onRefreshRecords();
                          }}
                          className="text-slate-500 hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 3: MASTER-DETAIL VIEW */}
      {layout === 'master-detail' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-2 max-h-[620px] overflow-y-auto">
            {filteredRecords.map((rec) => {
              const isSelected = activeDetailRecord?.id === rec.id;
              const inCart = contextCartIds.has(rec.id);
              return (
                <div
                  key={rec.id}
                  onClick={() => setSelectedRecordId(rec.id)}
                  className={`p-3 rounded-lg border transition cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-indigo-950/60 border-indigo-500 text-white'
                      : 'bg-slate-950/50 border-slate-800/80 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="text-sm font-medium truncate">
                      {String(rec.data[primaryKey] || 'Untitled')}
                    </div>
                    {subtitleKey && (
                      <div className="text-xs text-slate-400 truncate">
                        {String(rec.data[subtitleKey] || '')}
                      </div>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={inCart}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggleContextCart(rec.id)}
                    className="w-4 h-4 rounded accent-indigo-500 cursor-pointer shrink-0"
                  />
                </div>
              );
            })}
          </div>

          <div className="lg:col-span-8 bg-slate-900/90 border border-slate-800 rounded-xl p-6">
            {activeDetailRecord ? (
              <div className="space-y-5">
                <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {String(activeDetailRecord.data[primaryKey] || 'Record Detail')}
                    </h3>
                    <p className="text-xs text-slate-400 font-mono mt-1">
                      UUID: {activeDetailRecord.id} • Updated:{' '}
                      {new Date(activeDetailRecord.updated_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onToggleContextCart(activeDetailRecord.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                        contextCartIds.has(activeDetailRecord.id)
                          ? 'bg-indigo-600 text-white border-indigo-500'
                          : 'bg-slate-950 text-slate-300 border-slate-800'
                      }`}
                    >
                      {contextCartIds.has(activeDetailRecord.id)
                        ? 'In Context Cart'
                        : 'Add to Context Cart'}
                    </button>
                    <button
                      onClick={() => openInJsonInspector(activeDetailRecord)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-indigo-300 cursor-pointer"
                    >
                      Open in JSON Inspector
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {schemaKeys.map((k) => {
                    const val = activeDetailRecord.data[k];
                    const propDesc = selectedBp?.json_schema.properties[k]?.description;
                    return (
                      <div
                        key={k}
                        className={`p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 ${
                          Array.isArray(val) || String(val).length > 90 ? 'md:col-span-2' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-mono font-semibold text-indigo-300">
                            {k}
                          </span>
                          <span className="text-[10px] text-slate-500">{propDesc}</span>
                        </div>
                        {Array.isArray(val) ? (
                          <ul className="list-disc list-inside space-y-1 text-xs text-slate-200 mt-1">
                            {val.map((item, i) => (
                              <li key={i}>{String(item)}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-sm text-slate-100 mt-1">{String(val ?? '—')}</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {activeDetailRecord.raw_source && (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block mb-1">
                      Original Unstructured Source Text Backup
                    </span>
                    <p className="text-xs text-slate-400 whitespace-pre-wrap">
                      {activeDetailRecord.raw_source}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-12 text-center text-sm text-slate-500">
                Select a record on the left to inspect its structured properties.
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 4: RAW JSON INSPECTOR VIEW WITH LIVE SCHEMA VALIDATION */}
      {layout === 'json' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-2 max-h-[600px] overflow-y-auto">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-2 py-1">
              Select Record to Inspect
            </div>
            {filteredRecords.map((rec) => (
              <button
                key={rec.id}
                onClick={() => openInJsonInspector(rec)}
                className={`w-full text-left p-3 rounded-lg border text-xs transition cursor-pointer ${
                  inspectorRecordId === rec.id
                    ? 'bg-indigo-950/60 border-indigo-500 text-white'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="font-medium truncate">
                  {String(rec.data[primaryKey] || rec.id)}
                </div>
                <div className="font-mono text-[10px] text-slate-500 mt-0.5">{rec.id}</div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-8 bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-white">
                  Live Schema-Validated JSON Inspector
                </h3>
                {inspectorValid ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Conforms to {selectedBp?.name} Schema
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/20 text-rose-300 border border-rose-500/40">
                    <AlertTriangle className="w-3.5 h-3.5" /> Schema Violation Detected
                  </span>
                )}
              </div>

              <button
                onClick={handleSaveInspectorRecord}
                disabled={!inspectorValid || !inspectorRecordId}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                Save Validated JSON
              </button>
            </div>

            {!inspectorValid && inspectorErrors.length > 0 && (
              <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 font-mono text-xs text-rose-200 space-y-1">
                {inspectorErrors.map((e, idx) => (
                  <div key={idx}>• {e}</div>
                ))}
              </div>
            )}

            <textarea
              value={inspectorText}
              onChange={(e) => handleInspectorChange(e.target.value)}
              rows={20}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none p-4 font-mono text-xs text-emerald-300 leading-relaxed"
            />
          </div>
        </div>
      )}
    </div>
  );
}
