# Strux — AI-Powered Structured Data & Context Manager

**Strux** is a full-stack web application that transforms messy, unstructured text into rigorous, schema-validated JSON collections using the **Google Gemini API (`@google/genai` / `gemini-3.8-flash`)** and **`responseSchema` Structured Outputs**.

---

## 4-Stage Lifecycle Architecture

1. **Module 1: The Schema Architect (Meta-Prompting)**
   - Describe what you want to track in natural language or paste sample unstructured text.
   - Uses **Prompt A (Schema Architect System Prompt)** + Gemini `responseSchema` to propose a clean Draft-07 / OpenAPI 3.0 compatible JSON Schema where every field's `description` acts as an explicit instruction for the downstream LLM extractor.
   - Interactive AI refinement chat + Visual Field Builder table (`field_name`, `type`, `description`, `required`, `enum`) + raw JSON Schema inspector.
   - Saves reusable **Blueprints** with display metadata, Lucide icons, primary/subtitle/badge field mappings, and semantic versions.

2. **Module 2: The Data Extractor (Unstructured → Structured JSON)**
   - Select any active Blueprint and paste raw notes, meeting transcripts, or upload `.txt` / `.md` files.
   - Dynamically constructs an extraction prompt combining the Blueprint's property descriptions, custom extraction rules, and raw unstructured input.
   - Supports both **Single Object Extraction** (`1 note -> 1 JSON object`) and **Batch Extraction** (`1 long document -> Array of JSON objects`) using **Prompt B (Data Ingestion Engine System Prompt)**.
   - **Staging Review & Diff UI**: Live JSON Schema validation (via `ajv`) with side-by-side source text comparison and inline JSON editing before committing to SQLite.

3. **Module 3: Collection Manager & Multi-View Display**
   - Persists validated JSON records inside SQLite (`data/strux.db`).
   - **Dynamic Multi-View Engine**:
     - **Card Grid View**: Auto-maps primary title, subtitle, enum badges, and array/text body properties.
     - **Spreadsheet / Table View**: Sortable columns for every top-level JSON key with **double-click inline cell editing**.
     - **Master-Detail View**: Split-pane record browser with full field descriptions and original `raw_source` backup.
     - **JSON Inspector View**: Raw syntax-highlighted JSON editor with live schema validation.
   - Full-text search across all fields, enum/tag filtering, and `.json` / `.csv` import & export.

4. **Module 4: Context Studio (RAG & Querying with Structured Data)**
   - **Context Cart / Selector**: Check individual records across one or more collections (or select an entire filtered view) to assemble an active Context Payload.
   - **Token & Context Preview**: Inspect the exact formatted JSON block injected into the system prompt alongside a live token estimate.
   - **Saved Prompts Library**: Save and reuse custom system instructions linked to default blueprints.
   - **Round-Trip Saving**: Generate new schema-validated items grounded strictly in your selected context records and commit them directly back into a collection with a one-click **Save to Collection** button.

---

## Tech Stack

- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS v4, Lucide Icons
- **Backend / API Layer**: Node.js, Express, TypeScript (`tsx`), `ajv` JSON Schema validator
- **Database / Persistence**: SQLite (`node:sqlite` WAL mode) storing `blueprints`, `records`, `saved_prompts`, and `app_settings`
- **AI Integration**: `@google/genai` official Google Gen AI SDK (`gemini-3.8-flash` with `responseMimeType: "application/json"` and `responseSchema`)

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Gemini API Key (Optional at startup — configurable in UI)

Create a `.env` file (or copy `.env.example`):

```bash
cp .env.example .env
```

Set `GEMINI_API_KEY=your_key_here`, **or** launch the app and click **System Prompts & API Key** in the top bar / sidebar to enter your key directly in the UI. When no key is configured, Strux automatically provides an offline deterministic synthesis fallback so all 4 modules can be explored immediately.

### 3. Start Full-Stack Development Server

```bash
npm run dev
```

- **Frontend UI**: `http://localhost:5173`
- **Backend API & SQLite**: `http://localhost:3001`

### 4. Build & Run Production Bundle

```bash
npm run build
npm start
```
