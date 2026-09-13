# @env-keeper/core

Pure logic for working with `.env` files and shell configuration: parsing and writing back, secret detection and masking, snapshots, profiles, and shell snippet analysis.

No file system access, no UI framework, no runtime dependencies. Every function takes strings or plain objects and returns strings or plain objects, so it can be tested in isolation and reused from any host — a CLI, an editor plugin, a launcher extension.

## Install

```sh
npm install @env-keeper/core
```

ESM only. Ships TypeScript declarations.

## Usage

```ts
import { parseEnv, serializeEnv, addEnvVariable, isSecretKey, maskSecret } from "@env-keeper/core";

const lines = parseEnv(await readFile(".env", "utf8"));
const next = addEnvVariable(lines, "API_KEY", "sk-…");
await writeFile(".env", serializeEnv(next));

isSecretKey("API_KEY"); // true
maskSecret("sk-…");     // "••••••••"
```

## What's inside

| Module | Purpose |
|---|---|
| `parseEnv` | Parse `.env` text into lines (variables, comments, blanks) and serialize back without losing formatting |
| `envOps` | Add / update / remove / toggle variables, secret detection by key and by value, masking, `.env.example` generation as a merge, diffs, fingerprints, env-file name rules |
| `snapshots` | Snapshot file naming and soft limits |
| `presets` | Profiles: several parallel sets of `.env` content, grouping, drift detection, versioned storage format |
| `registry` | Registered projects: ids, rename, relocate, per-project secret marks, versioned storage format |
| `shellTrack` | Shell snippets (`export` / `alias` / free-form): grouping, ordering, duplicate detection, lexical analysis of assignments, masking, script generation |
| `shellLint` | Spelling hints for assignments that are valid syntax but will never take effect (`exprot FOO=1`) |
| `configFile` | Versioned config file parsing with explicit failure reasons |

## Parsing rules

`parseEnv` follows **dotenv v16**: `export` prefix, `[\w.-]+` keys, unquoted values trimmed, single / double / backtick quotes, `\n` expansion inside double quotes, multi-line quoted values, inline comments. The rules were checked case by case against dotenv 16.6.1, because the values are ultimately read by tools like Vite and Next through dotenv — any mismatch means "what the UI shows ≠ what the program gets".

## Development

```sh
pnpm check   # typecheck + tests + build (also run by the pre-commit hook)
pnpm test    # vitest
```

Release: `npm version patch|minor|major` → `npm publish` (`publishConfig.access` is `public`; `.npmrc` pins the official registry).

## Used by

[Env Keeper](https://github.com/MrMengJ/raycast-env-butler), a Raycast extension for managing `.env` files and shell config.

## License

MIT
