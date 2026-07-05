# Lootmaster Project Agents

Project-specific sub-agents for the Lootmaster DayZ server management dashboard.
Agent definitions live in `.claude/agents/`. Invoke via the Agent tool with the name below.

## lootmaster-frontend
**File**: `.claude/agents/lootmaster-frontend.md`
**Use for**: React component authoring, Untitled UI patterns, Tailwind styling, Hierarchical Editor (dnd-kit), TypeScript prop interfaces, dark-mode correctness.
**Skip when**: the task is about server-side logic, XML parsing utilities, or DayZ economy domain rules.

## lootmaster-backend
**File**: `.claude/agents/lootmaster-backend.md`
**Use for**: `server/index.js` changes, profile/mission file I/O, IndexedDB schema (`src/utils/idb.js`), XML serialisation (`src/utils/xml.ts`), API endpoint design, change-log audit trail.
**Skip when**: the task is about React rendering or DayZ config semantics.

## lootmaster-dayz
**File**: `.claude/agents/lootmaster-dayz.md`
**Use for**: DayZ CLE domain questions — types.xml schema, cfgeconomycore.xml structure, spawnable types resolution hierarchy, Expansion Mod integration (market, airdrops, traders), cfglimitsdefinition.xml validation rules, vanilla override protection logic.
**Skip when**: you need implementation code — this agent analyses and specifies; it routes coding tasks to the other two.

---

## Decision guide

| I need to… | Use |
|------------|-----|
| Build or fix a React component | `lootmaster-frontend` |
| Add or change a UI interaction / layout | `lootmaster-frontend` |
| Work on the dnd-kit hierarchical tree | `lootmaster-frontend` |
| Modify the Node.js server or its routes | `lootmaster-backend` |
| Change XML parsing or generation logic | `lootmaster-backend` |
| Work with IndexedDB or persistence | `lootmaster-backend` |
| Understand how a DayZ config field works | `lootmaster-dayz` |
| Debug why a types.xml value behaves unexpectedly | `lootmaster-dayz` |
| Add support for a new DayZ map or add-on | `lootmaster-dayz` (spec) → then appropriate coder |
