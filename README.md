# Kahboard Seeder

An interactive TypeScript CLI that loads a YAML board definition, validates it,
compares it with Kanboard, displays a read-only plan, asks for approval, and then
applies the changes sequentially with progress indicators.

## Requirements

- Node.js 22 or newer
- A Kanboard personal access token

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your Kanboard URL, username, and API key.
npm run dev
```

`KANBOARD_URL` can be the base URL or the complete `jsonrpc.php` endpoint.
Configuration is loaded from `.env` with `dotenv`. The `.env` file is ignored
by Git and credentials must not be placed in definition files.

## Safety model

Planning only reads from Kanboard. Apply is unavailable until the definition
passes Zod validation and a plan has been generated. The selected file is
hashed after validation and checked again after approval; a changed file must
be validated and planned again.

The seeder creates missing projects, columns, tasks, subtasks, and dependency
links, then positions declared tasks. It does not delete existing Kanboard
objects. If an action fails, processing stops. Run it again to generate an
idempotent plan containing the remaining work.

## Commands

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm start
```

Definitions belong in `defs/` and may use `.yaml` or `.yml`.
The optional task `assignee` field overrides the owner for that task. When it
is omitted, the task is assigned to the Kanboard user authenticated by the
credentials in `.env`. If a YAML assignee is not found in Kanboard, the CLI
prompts you to map that assignee to one of the users returned by Kanboard and
then replans before applying changes.
