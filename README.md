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
export KANBOARD_URL="https://kanboard.example.com"
export KANBOARD_USERNAME="your-username"
export KANBOARD_API_KEY="your-personal-access-token"
npm run dev
```

`KANBOARD_URL` can be the base URL or the complete `jsonrpc.php` endpoint.
Credentials come from the environment and must not be placed in definition
files.

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
