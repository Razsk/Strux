import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { Blueprint, StruxRecord, SavedPrompt } from '../src/types.ts';

const isTestEnv = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test');
const dbPath =
  process.env.DB_PATH || (isTestEnv ? ':memory:' : path.join(process.cwd(), 'data', 'strux.db'));
if (dbPath !== ':memory:') {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

export const db = new DatabaseSync(dbPath);
if (dbPath !== ':memory:') {
  db.exec('PRAGMA journal_mode = WAL;');
}
db.exec('PRAGMA foreign_keys = ON;');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS blueprints (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      json_schema TEXT NOT NULL,
      extraction_prompt_template TEXT NOT NULL,
      ui_config TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      blueprint_id TEXT NOT NULL,
      data TEXT NOT NULL,
      raw_source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (blueprint_id) REFERENCES blueprints(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saved_prompts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system_instruction TEXT NOT NULL,
      default_blueprint_ids TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const countRow = db.prepare('SELECT COUNT(*) as count FROM blueprints').get() as { count: number };
  if (Number(countRow.count) === 0) {
    seedInitialData();
  }
}

function seedInitialData() {
  const now = new Date().toISOString();

  // Blueprint 1: TTRPG Encounters & NPCs (from SRD Section 3)
  const bpRpgId = 'bp-ttrpg-encounters';
  const bpRpg: Blueprint = {
    id: bpRpgId,
    name: 'TTRPG Encounters & Intrigue',
    description: 'Track tabletop RPG encounters, locations, factions, motives, clues, relationship matrices, and threat intensity levels.',
    json_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short, evocative title of the encounter, scene, or plot hook.'
        },
        location: {
          type: 'string',
          description: 'Specific region, district, or landmark where the encounter takes place.'
        },
        intensity_level: {
          type: 'string',
          description: 'Pacing and danger intensity level of the encounter.',
          enum: ['Low', 'Moderate', 'High', 'Deadly']
        },
        encounter_type: {
          type: 'string',
          description: 'Primary gameplay pillar of the encounter.',
          enum: ['Social Intrigue', 'Investigation', 'Tactical Combat', 'Stealth & Heist', 'Exploration']
        },
        primary_antagonist_or_npc: {
          type: 'string',
          description: 'Name and role of the key NPC, monster, or villain anchoring the scene.'
        },
        motive: {
          type: 'string',
          description: 'Hidden agenda or driving goal of the NPC/antagonist in this scene.'
        },
        clues: {
          type: 'array',
          description: 'List of actionable clues, secrets, or physical evidence players can discover.',
          items: { type: 'string' }
        },
        relationship_matrix: {
          type: 'array',
          description: 'Faction or NPC ties formatted as "Entity -> Attitude/Relation (Reason)".',
          items: { type: 'string' }
        },
        loot_or_outcome: {
          type: 'string',
          description: 'Rewards, narrative consequences, or branching outcomes.'
        }
      },
      required: ['title', 'location', 'intensity_level', 'encounter_type', 'motive', 'clues']
    },
    extraction_prompt_template: 'Keep tone atmospheric and concise. Extract concrete actionable clues as distinct array strings. Format relationship_matrix entries clearly as "Target -> Relation".',
    ui_config: {
      icon: 'Swords',
      version: '1.2.0',
      primaryField: 'title',
      subtitleField: 'location',
      badgeFields: ['intensity_level', 'encounter_type'],
      colorAccent: 'indigo'
    },
    created_at: now,
    updated_at: now
  };

  // Blueprint 2: Infrastructure Server Nodes (from SRD Section 1)
  const bpInfraId = 'bp-server-nodes';
  const bpInfra: Blueprint = {
    id: bpInfraId,
    name: 'Infrastructure Server Nodes',
    description: 'Catalog cloud and bare-metal cluster nodes, resource specs, environment tiers, runbooks, and incident state.',
    json_schema: {
      type: 'object',
      properties: {
        hostname: {
          type: 'string',
          description: 'Fully qualified hostname or node identifier (e.g., prod-db-replica-02).'
        },
        environment: {
          type: 'string',
          description: 'Deployment environment tier.',
          enum: ['Production', 'Staging', 'Development', 'DR-Failover']
        },
        health_status: {
          type: 'string',
          description: 'Current operational status of the node.',
          enum: ['Healthy', 'Degraded', 'Maintenance', 'Critical']
        },
        ip_address: {
          type: 'string',
          description: 'Primary private or Tailscale IPv4/IPv6 address.'
        },
        region: {
          type: 'string',
          description: 'Cloud availability zone or datacenter location (e.g., eu-central-1a).'
        },
        cpu_cores: {
          type: 'integer',
          description: 'Number of allocated vCPUs or physical cores.'
        },
        memory_gb: {
          type: 'number',
          description: 'Total provisioned RAM in gigabytes.'
        },
        services: {
          type: 'array',
          description: 'List of active daemons, containers, or workloads running on this node.',
          items: { type: 'string' }
        },
        owner_team: {
          type: 'string',
          description: 'Engineering squad or on-call rotation responsible for this node.'
        },
        notes: {
          type: 'string',
          description: 'Operational warnings, kernel tuning notes, or recent incident context.'
        }
      },
      required: ['hostname', 'environment', 'health_status', 'services']
    },
    extraction_prompt_template: 'Normalize hostnames to lowercase. Infer environment and health_status from context if mentioned. Extract numeric values for cpu_cores and memory_gb.',
    ui_config: {
      icon: 'Server',
      version: '1.0.0',
      primaryField: 'hostname',
      subtitleField: 'region',
      badgeFields: ['environment', 'health_status'],
      colorAccent: 'emerald'
    },
    created_at: now,
    updated_at: now
  };

  // Blueprint 3: Literature & Research Notes (from SRD Section 1)
  const bpNotesId = 'bp-research-notes';
  const bpNotes: Blueprint = {
    id: bpNotesId,
    name: 'Research & Book Synthesis',
    description: 'Structured atomic notes extracted from books, technical papers, and podcasts with claims, evidence, and citations.',
    json_schema: {
      type: 'object',
      properties: {
        concept_title: {
          type: 'string',
          description: 'Concise atomic title capturing the core thesis or concept.'
        },
        source_work: {
          type: 'string',
          description: 'Book title, paper citation, or speaker name.'
        },
        category: {
          type: 'string',
          description: 'Domain classification of the insight.',
          enum: ['AI & Systems', 'Cognitive Science', 'Distributed Architecture', 'Strategy', 'Philosophy']
        },
        epistemic_status: {
          type: 'string',
          description: 'Confidence level and empirical backing of the claim.',
          enum: ['Empirically Verified', 'Strong Heuristic', 'Speculative', 'Historical Case']
        },
        core_thesis: {
          type: 'string',
          description: '2-3 sentence summary of the primary argument in clear, dense prose.'
        },
        key_takeaways: {
          type: 'array',
          description: 'Actionable principles or bulleted supporting points.',
          items: { type: 'string' }
        },
        tags: {
          type: 'array',
          description: 'Lowercase topical keywords for cross-referencing.',
          items: { type: 'string' }
        }
      },
      required: ['concept_title', 'source_work', 'category', 'core_thesis', 'key_takeaways']
    },
    extraction_prompt_template: 'Distill rambling highlights or transcripts into high-signal atomic notes. Avoid fluff.',
    ui_config: {
      icon: 'BookOpen',
      version: '1.1.0',
      primaryField: 'concept_title',
      subtitleField: 'source_work',
      badgeFields: ['category', 'epistemic_status'],
      colorAccent: 'amber'
    },
    created_at: now,
    updated_at: now
  };

  const insertBp = db.prepare(`
    INSERT INTO blueprints (id, name, description, json_schema, extraction_prompt_template, ui_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const bp of [bpRpg, bpInfra, bpNotes]) {
    insertBp.run(
      bp.id,
      bp.name,
      bp.description,
      JSON.stringify(bp.json_schema),
      bp.extraction_prompt_template,
      JSON.stringify(bp.ui_config),
      bp.created_at,
      bp.updated_at
    );
  }

  const insertRecord = db.prepare(`
    INSERT INTO records (id, blueprint_id, data, raw_source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const sampleRecords: Array<{ blueprint_id: string; data: Record<string, any>; raw_source: string }> = [
    {
      blueprint_id: bpRpgId,
      data: {
        title: 'Whispering Vault of House Vane',
        location: 'Obsidian Spire — Undercroft Level 3',
        intensity_level: 'High',
        encounter_type: 'Stealth & Heist',
        primary_antagonist_or_npc: 'Archivist Malakor (Clockwork Lich)',
        motive: 'Preserve the forged bloodline charters of the High Council until the blood moon eclipse.',
        clues: [
          'Burned ledger page referencing shipment of soul-quartz to Dock 9',
          'Signet ring of Magistrate Corvo found inside a construct sentry',
          'Resonance tuning fork that opens the hidden reliquary behind the astral map'
        ],
        relationship_matrix: [
          'High Council -> Secret Patron (Blackmailed by Malakor)',
          'Iron Syndicate -> Hostile Rivals (Want the charters destroyed)',
          'Lady Seraphina -> Former Apprentice (Knows command phrase to stun constructs)'
        ],
        loot_or_outcome: 'Vane Bloodline Charter (political leverage), Chrono-Lens amulet, 450 platinum sovereigns.'
      },
      raw_source: 'Session prep notes: Party breaks into House Vane undercroft level 3 in the Obsidian Spire. High intensity heist. Guarded by Archivist Malakor, a clockwork lich hiding forged bloodline charters for the High Council...'
    },
    {
      blueprint_id: bpRpgId,
      data: {
        title: 'Ambush at Crimson Tollbridge',
        location: 'Ashen Fen — Old Imperial Causeway',
        intensity_level: 'Deadly',
        encounter_type: 'Tactical Combat',
        primary_antagonist_or_npc: 'Captain Varek "Red-Hound" & Mire-Drake',
        motive: 'Intercept the envoy caravan carrying the Sunstone Reliquary before it reaches the capital.',
        clues: [
          'Imperial cipher scroll showing someone inside the palace leaked the caravan route',
          'Crates of alchemical blasting oil stamped with the Iron Syndicate crest',
          'Tracks leading northeast toward the sunken Watchtower camp'
        ],
        relationship_matrix: [
          'Iron Syndicate -> Employer (Paid 2,000 gold bounty)',
          'Imperial Envoy -> Target (Carrying the Sunstone)',
          'Fenlanders -> Intimidated Locals (Forced to sabotage bridge timbers)'
        ],
        loot_or_outcome: 'Sunstone Reliquary secured, Varek’s Runed Glaive, Syndicate cipher key.'
      },
      raw_source: 'Deadly combat encounter at the Crimson Tollbridge in the Ashen Fen. Captain Varek Red-Hound and his trained Mire-Drake ambush the caravan...'
    },
    {
      blueprint_id: bpRpgId,
      data: {
        title: 'The Masquerade of Mirrors',
        location: 'Grand Conservatory of Velour',
        intensity_level: 'Moderate',
        encounter_type: 'Social Intrigue',
        primary_antagonist_or_npc: 'Duchess Lyra Vance',
        motive: 'Broker a covert alliance between the Merchant Guilds and the exiled fleet while framing Envoy Kael.',
        clues: [
          'Poisoned wine decanter bearing residue of Pale Lotus extract',
          'Overheard whispered exchange at the conservatory fountain at midnight',
          'Guest registry showing three doppelganger aliases signed in silver ink'
        ],
        relationship_matrix: [
          'Merchant Guilds -> Eager Conspirators (Seeking tariff abolition)',
          'Archivist Malakor -> Information Broker (Sold the blackmail letters)',
          'Envoy Kael -> Scapegoat (Unaware of the frame-up)'
        ],
        loot_or_outcome: 'Diplomatic immunity seal, invitation to the Inner Sanctum, prevention of guild coup.'
      },
      raw_source: 'Social intrigue at the Grand Conservatory of Velour. Duchess Lyra Vance hosts a masquerade to broker a secret alliance...'
    },
    {
      blueprint_id: bpInfraId,
      data: {
        hostname: 'prod-vector-idx-01.internal',
        environment: 'Production',
        health_status: 'Healthy',
        ip_address: '10.24.8.14',
        region: 'eu-central-1a',
        cpu_cores: 32,
        memory_gb: 128,
        services: ['qdrant-engine', 'node-exporter', 'vector-ingestor', 'envoy-proxy'],
        owner_team: 'AI Platform Core',
        notes: 'NVMe RAID0 configured for low-latency HNSW index memory mapping. Avoid rebooting during peak UTC 13:00-18:00.'
      },
      raw_source: 'prod-vector-idx-01.internal (10.24.8.14) in eu-central-1a. 32 cores, 128GB RAM. Running qdrant-engine, node-exporter, vector-ingestor, envoy-proxy. Healthy.'
    },
    {
      blueprint_id: bpInfraId,
      data: {
        hostname: 'prod-ingest-worker-04.internal',
        environment: 'Production',
        health_status: 'Degraded',
        ip_address: '10.24.12.44',
        region: 'eu-central-1b',
        cpu_cores: 16,
        memory_gb: 64,
        services: ['strux-extractor-worker', 'redis-consumer', 'otel-collector'],
        owner_team: 'Data Pipeline Squad',
        notes: 'Experiencing elevated GC pauses when batching >500k token documents. Scheduled for memory upgrade.'
      },
      raw_source: 'Node prod-ingest-worker-04.internal in eu-central-1b (10.24.12.44) is currently Degraded. 16 vCPU, 64GB RAM. Runs strux-extractor-worker, redis-consumer, otel-collector.'
    },
    {
      blueprint_id: bpNotesId,
      data: {
        concept_title: 'Schema-Constrained Decoding Eliminates Hallucinated Syntax',
        source_work: 'Structured Generation in LLM Pipelines (2025)',
        category: 'AI & Systems',
        epistemic_status: 'Empirically Verified',
        core_thesis: 'Enforcing context-free grammars or JSON Schema at the token sampling layer guarantees syntactic validity and shifts prompt engineering focus toward field-level semantic descriptions.',
        key_takeaways: [
          'Property descriptions inside JSON Schema act as micro-prompts for every individual field.',
          'Separating unstructured ingestion from downstream reasoning reduces RAG noise by 60-80%.',
          'Flat schemas with explicit enums outperform deeply nested unconstrained objects.'
        ],
        tags: ['structured-outputs', 'json-schema', 'gemini', 'context-engineering']
      },
      raw_source: 'Paper notes on Structured Generation in LLM Pipelines: constraining token decoding to JSON schema guarantees valid syntax and turns property descriptions into micro-prompts...'
    }
  ];

  for (const rec of sampleRecords) {
    insertRecord.run(
      crypto.randomUUID(),
      rec.blueprint_id,
      JSON.stringify(rec.data),
      rec.raw_source,
      now,
      now
    );
  }

  const insertPrompt = db.prepare(`
    INSERT INTO saved_prompts (id, name, system_instruction, default_blueprint_ids, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const samplePrompts: SavedPrompt[] = [
    {
      id: 'prompt-rpg-synthesizer',
      name: 'RPG Session & Encounter Generator',
      system_instruction: 'You are a master tabletop RPG designer. Analyze the provided structured encounter records, factions, and clues in the context payload. Weave connections between existing NPCs and motives, or generate a cohesive new encounter that escalates the ongoing conspiracy.',
      default_blueprint_ids: [bpRpgId],
      created_at: now
    },
    {
      id: 'prompt-infra-auditor',
      name: 'SRE Reliability & Blast-Radius Auditor',
      system_instruction: 'You are a Principal Site Reliability Engineer. Inspect the selected server node configurations, identify single points of failure, resource bottlenecks, or degraded services, and propose concrete remediation steps.',
      default_blueprint_ids: [bpInfraId],
      created_at: now
    },
    {
      id: 'prompt-knowledge-synthesizer',
      name: 'Cross-Collection Synthesis & Q&A',
      system_instruction: 'You are the Strux Context Studio analyst. Ground your answer strictly in the provided structured JSON records. Cite specific record fields and synthesize patterns clearly.',
      default_blueprint_ids: [bpRpgId, bpInfraId, bpNotesId],
      created_at: now
    }
  ];

  for (const sp of samplePrompts) {
    insertPrompt.run(
      sp.id,
      sp.name,
      sp.system_instruction,
      JSON.stringify(sp.default_blueprint_ids),
      sp.created_at!
    );
  }
}

export function getAllBlueprints(): Blueprint[] {
  const rows = db.prepare(`
    SELECT b.*, COUNT(r.id) as record_count
    FROM blueprints b
    LEFT JOIN records r ON r.blueprint_id = b.id
    GROUP BY b.id
    ORDER BY b.updated_at DESC
  `).all() as any[];

  return rows.map((row) => ({
    ...row,
    json_schema: JSON.parse(row.json_schema),
    ui_config: JSON.parse(row.ui_config),
    record_count: Number(row.record_count || 0)
  }));
}

export function getBlueprintById(id: string): Blueprint | null {
  const row = db.prepare(`
    SELECT b.*, COUNT(r.id) as record_count
    FROM blueprints b
    LEFT JOIN records r ON r.blueprint_id = b.id
    WHERE b.id = ?
    GROUP BY b.id
  `).get(id) as any;

  if (!row) return null;
  return {
    ...row,
    json_schema: JSON.parse(row.json_schema),
    ui_config: JSON.parse(row.ui_config),
    record_count: Number(row.record_count || 0)
  };
}

export function createBlueprint(input: Omit<Blueprint, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Blueprint {
  const id = input.id || crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO blueprints (id, name, description, json_schema, extraction_prompt_template, ui_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.description,
    JSON.stringify(input.json_schema),
    input.extraction_prompt_template || '',
    JSON.stringify(input.ui_config),
    now,
    now
  );
  return getBlueprintById(id)!;
}

export function updateBlueprint(id: string, input: Partial<Omit<Blueprint, 'id' | 'created_at' | 'updated_at'>>): Blueprint | null {
  const existing = getBlueprintById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE blueprints
    SET name = ?,
        description = ?,
        json_schema = ?,
        extraction_prompt_template = ?,
        ui_config = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    input.name ?? existing.name,
    input.description ?? existing.description,
    JSON.stringify(input.json_schema ?? existing.json_schema),
    input.extraction_prompt_template ?? existing.extraction_prompt_template,
    JSON.stringify(input.ui_config ?? existing.ui_config),
    now,
    id
  );
  return getBlueprintById(id);
}

export function deleteBlueprint(id: string): boolean {
  const info = db.prepare('DELETE FROM blueprints WHERE id = ?').run(id);
  return Number(info.changes) > 0;
}

export function getRecords(blueprintId?: string): StruxRecord[] {
  const rows = blueprintId
    ? (db.prepare('SELECT * FROM records WHERE blueprint_id = ? ORDER BY updated_at DESC').all(blueprintId) as any[])
    : (db.prepare('SELECT * FROM records ORDER BY updated_at DESC').all() as any[]);

  return rows.map((r) => ({
    ...r,
    data: JSON.parse(r.data)
  }));
}

export function getRecordById(id: string): StruxRecord | null {
  const row = db.prepare('SELECT * FROM records WHERE id = ?').get(id) as any;
  if (!row) return null;
  return {
    ...row,
    data: JSON.parse(row.data)
  };
}

export function createRecord(blueprint_id: string, data: Record<string, any>, raw_source?: string | null): StruxRecord {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO records (id, blueprint_id, data, raw_source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    blueprint_id,
    JSON.stringify(data),
    raw_source ?? null,
    now,
    now
  );
  return getRecordById(id)!;
}

export function normalizeMasterKeyValue(val: unknown): string {
  if (val === undefined || val === null) return '';
  return String(val)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function mergeRecordData(
  existingData: Record<string, any>,
  incomingData: Record<string, any>
): Record<string, any> {
  const merged: Record<string, any> = { ...existingData };

  for (const [key, incVal] of Object.entries(incomingData)) {
    if (incVal === undefined || incVal === null || incVal === '') {
      continue;
    }

    if (Array.isArray(incVal)) {
      if (incVal.length === 0) continue;
      const existingArr = Array.isArray(existingData[key]) ? existingData[key] : [];
      const seen = new Set(existingArr.map((x: any) => String(x).trim().toLowerCase()));
      const combined = [...existingArr];
      for (const item of incVal) {
        const norm = String(item).trim().toLowerCase();
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          combined.push(item);
        }
      }
      merged[key] = combined;
    } else if (typeof incVal === 'object' && existingData[key] && typeof existingData[key] === 'object') {
      merged[key] = { ...existingData[key], ...incVal };
    } else {
      merged[key] = incVal;
    }
  }

  return merged;
}

export function createRecordsBatch(
  blueprint_id: string,
  items: Array<{
    data: Record<string, any>;
    raw_source?: string | null;
    strategy?: 'merge' | 'overwrite' | 'create_new';
  }>
): { records: StruxRecord[]; insertedCount: number; mergedCount: number } {
  const blueprint = getBlueprintById(blueprint_id);
  const schemaKeys = Object.keys(blueprint?.json_schema?.properties || {});
  const masterKeyField =
    blueprint?.ui_config?.masterKeyField ||
    blueprint?.ui_config?.primaryField ||
    schemaKeys[0] ||
    'title';

  const existingRecords = getRecords(blueprint_id);
  const existingByKey = new Map<string, StruxRecord>();
  for (const rec of existingRecords) {
    const normKey = normalizeMasterKeyValue(rec.data[masterKeyField]);
    if (normKey && !existingByKey.has(normKey)) {
      existingByKey.set(normKey, rec);
    }
  }

  const insertStmt = db.prepare(`
    INSERT INTO records (id, blueprint_id, data, raw_source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE records
    SET data = ?,
        raw_source = ?,
        updated_at = ?
    WHERE id = ?
  `);

  const touchedIds: string[] = [];
  let insertedCount = 0;
  let mergedCount = 0;
  const now = new Date().toISOString();

  db.exec('BEGIN TRANSACTION');
  try {
    for (const item of items) {
      const strategy = item.strategy || 'merge';
      const incomingMasterVal = normalizeMasterKeyValue(item.data[masterKeyField]);
      const matched =
        strategy !== 'create_new' && incomingMasterVal
          ? existingByKey.get(incomingMasterVal)
          : undefined;

      if (matched) {
        const finalData =
          strategy === 'overwrite'
            ? item.data
            : mergeRecordData(matched.data, item.data);

        const combinedRawSource =
          item.raw_source && matched.raw_source && item.raw_source !== matched.raw_source
            ? `${matched.raw_source}\n\n--- [Merged Update ${now}] ---\n${item.raw_source}`
            : item.raw_source ?? matched.raw_source ?? null;

        updateStmt.run(
          JSON.stringify(finalData),
          combinedRawSource,
          now,
          matched.id
        );
        matched.data = finalData;
        touchedIds.push(matched.id);
        mergedCount++;
      } else {
        const id = crypto.randomUUID();
        insertStmt.run(
          id,
          blueprint_id,
          JSON.stringify(item.data),
          item.raw_source ?? null,
          now,
          now
        );
        if (incomingMasterVal) {
          existingByKey.set(incomingMasterVal, {
            id,
            blueprint_id,
            data: item.data,
            raw_source: item.raw_source ?? null,
            created_at: now,
            updated_at: now
          });
        }
        touchedIds.push(id);
        insertedCount++;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    records: touchedIds.map((id) => getRecordById(id)!),
    insertedCount,
    mergedCount
  };
}

export function updateRecord(id: string, data: Record<string, any>, raw_source?: string | null): StruxRecord | null {
  const existing = getRecordById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE records
    SET data = ?,
        raw_source = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(data),
    raw_source !== undefined ? raw_source : (existing.raw_source ?? null),
    now,
    id
  );
  return getRecordById(id);
}

export function deleteRecord(id: string): boolean {
  const info = db.prepare('DELETE FROM records WHERE id = ?').run(id);
  return Number(info.changes) > 0;
}

export function deleteRecordsBatch(ids: string[]): number {
  const del = db.prepare('DELETE FROM records WHERE id = ?');
  let count = 0;
  db.exec('BEGIN TRANSACTION');
  try {
    for (const id of ids) {
      count += Number(del.run(id).changes);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return count;
}

export function getSavedPrompts(): SavedPrompt[] {
  const rows = db.prepare('SELECT * FROM saved_prompts ORDER BY created_at DESC').all() as any[];
  return rows.map((r) => ({
    ...r,
    default_blueprint_ids: JSON.parse(r.default_blueprint_ids || '[]')
  }));
}

export function createSavedPrompt(input: Omit<SavedPrompt, 'id' | 'created_at'>): SavedPrompt {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO saved_prompts (id, name, system_instruction, default_blueprint_ids, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.system_instruction,
    JSON.stringify(input.default_blueprint_ids || []),
    now
  );
  return {
    id,
    name: input.name,
    system_instruction: input.system_instruction,
    default_blueprint_ids: input.default_blueprint_ids || [],
    created_at: now
  };
}

export function deleteSavedPrompt(id: string): boolean {
  const info = db.prepare('DELETE FROM saved_prompts WHERE id = ?').run(id);
  return Number(info.changes) > 0;
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}
