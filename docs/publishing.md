# Publishing xiaodao-editor to npm

This document describes the complete workflow for publishing `xiaodao-editor` as an npm package.

## Pre-publish checklist

- [ ] `pnpm typecheck` passes, no TypeScript errors
- [ ] `pnpm lint:check` passes, no ESLint warnings
- [ ] `pnpm build` succeeds and the `dist/` output is generated
- [ ] Version in `package.json` has been bumped per [Semantic Versioning](#versioning)
- [ ] You are logged into npm and have publish access to `xiaodao-editor`
- [ ] No uncommitted local changes (publish from a clean git HEAD)

## One-time setup

### 1. Install Node.js / npm / pnpm

- Node.js ≥ 18
- npm ≥ 9 (shipped with Node.js)
- pnpm ≥ 10 (project pins `packageManager: pnpm@10.29.2`)

```sh
corepack enable
corepack prepare pnpm@10.29.2 --activate
```

### 2. Log into npm

```sh
npm login
```

Enter username, password, email and a 2FA one-time password (if 2FA is enabled).
Verify with `npm whoami` after login.

### 3. Check package availability

```sh
npm view xiaodao-editor version
```

- `E404` means the name is free — publish is clear
- A returned version number means the package already exists — confirm you are a collaborator or owner

## Versioning

Follow [Semantic Versioning 2.0.0](https://semver.org/):

| Bump type | When to use | Example |
|-----------|-------------|---------|
| `MAJOR` | Incompatible / breaking API changes | `0.1.1` → `1.0.0` |
| `MINOR` | Backwards-compatible new functionality | `0.1.1` → `0.2.0` |
| `PATCH` | Backwards-compatible bug fixes | `0.1.1` → `0.1.2` |

**Bump commands (pick one):**

```sh
# Updates package.json only, no git tag
npm version patch --no-git-tag-version   # PATCH
npm version minor --no-git-tag-version   # MINOR
npm version major --no-git-tag-version   # MAJOR

# Or with pnpm
pnpm version patch
```

Then commit and tag:

```sh
git add package.json
git commit -m "release: v0.1.2"
git tag v0.1.2
git push origin main
git push origin v0.1.2
```

## Publish steps

### 1. Install dependencies

```sh
pnpm install
```

### 2. Run quality checks

```sh
pnpm typecheck
pnpm lint:check
```

### 3. Build

The `prepublishOnly` script auto-runs before publish, but verifying manually first is recommended:

```sh
pnpm build
```

After success, confirm `dist/` contains at minimum:

```
dist/
├── block-editor.js        # ES module entry
├── block-editor.umd.cjs   # CommonJS / UMD entry
├── style.css              # Stylesheet
└── index.d.ts             # TypeScript declaration entry
```

### 4. Inspect packed contents

Verify the files going into the tarball:

```sh
pnpm pack
# or
npm pack --dry-run
```

The output should only contain `package.json` and `dist/**/*` — no `src/`, `playground/`, `docs/`, `.gitignore` or other unrelated files.
The `files` field in `package.json` limits inclusion to `["dist"]`. Add a `.npmignore` if extra files leak in.

### 5. Publish

```sh
pnpm publish
```

This command:
1. Runs `prepublishOnly` → `pnpm build` automatically
2. Packs the files listed in `package.json`'s `files` field
3. Uploads to the official npm registry

> If 2FA is enabled on your account, you'll be prompted for a one-time password.

**Verify after success:**

```sh
npm view xiaodao-editor version   # should return the just-published version
```

## Dual publishing with GitHub Actions

The project includes a GitHub Actions workflow (`.github/workflows/publish.yml`)
that automatically publishes to **both** npmjs.org and GitHub Packages when you
push a version tag.

### How it works

| Job | Registry | Package name | Auth token |
|-----|----------|--------------|------------|
| `publish-npm` | `registry.npmjs.org` | `xiaodao-editor` | `NPM_TOKEN` secret |
| `publish-github` | `npm.pkg.github.com` | `@xiaodaozhi/xiaodao-editor` (temporarily renamed) | `GITHUB_TOKEN` (auto-provided) |

Both jobs run in parallel. The GitHub Packages job temporarily renames the
package to `@xiaodaozhi/xiaodao-editor` via `npm pkg set name=...` because
GitHub Packages requires scoped names. The `dist/` build output is identical
for both registries — only the package name differs.

### One-time setup

#### 1. Create an npm access token

1. Go to [npmjs.com](https://www.npmjs.com) → Access Tokens → Generate New Token
2. Select token type **Automation** (works without 2FA)
3. Copy the token (`npm_...`)

#### 2. Add `NPM_TOKEN` as a repository secret

GitHub repo → Settings → Secrets and variables → Actions → New repository secret

- Name: `NPM_TOKEN`
- Value: paste the token from step 1

#### 3. `GITHUB_TOKEN` requires no setup

The `GITHUB_TOKEN` is automatically provided by GitHub Actions on every run.
The workflow already declares `permissions: packages: write` so it can
publish to GitHub Packages.

#### 4. Ensure `repository` field matches

The `repository` field in `package.json` must point to the correct GitHub repo:

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/xiaodaozhi/xiaodao-editor.git"
}
```

GitHub Packages uses this to link the package to your repository.

### Triggering a release

```sh
# 1. Bump version
npm version patch --no-git-tag-version

# 2. Commit
git add -A
git commit -m "release: v0.1.2"

# 3. Tag and push
git tag v0.1.2
git push origin main
git push origin v0.1.2
```

Pushing the `v*` tag triggers the workflow. Monitor progress at:

```
https://github.com/xiaodaozhi/xiaodao-editor/actions
```

### Differences between the two registries

| | npmjs.org | GitHub Packages |
|---|---|---|
| Package name | `xiaodao-editor` | `@xiaodaozhi/xiaodao-editor` |
| Auth for publishing | `NPM_TOKEN` (Automation token) | `GITHUB_TOKEN` (auto) |
| Auth for installing (public) | Not required | `read:packages` PAT required |
| Manual publish | `npm publish` (from local) | Via Actions workflow only |

### Installing from GitHub Packages

Consumers who prefer GitHub Packages need to authenticate:

1. Create a PAT with `read:packages` scope (GitHub Settings → Developer
   settings → Personal access tokens → classic)

2. Add a `.npmrc` to their project:

```ini
@xiaodaozhi:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=ghp_their-token
```

3. Install:

```sh
npm install @xiaodaozhi/xiaodao-editor
```

> Even though the package is public, GitHub Packages always requires a token
> for installation.

## Common publish failures and fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `E401 Unauthorized` | Not logged in or session expired | `npm login` again |
| `E402 Payment Required` | Publishing a scoped private package without a paid team | Use `--access public` or check `publishConfig` |
| `E403 Forbidden` | Current account lacks write access | Ask the owner to invite you as a collaborator |
| `EPERMYSCOPE` | Using a scope you don't belong to | Change the package name or request scope membership |
| `E409 Conflict` | This version already exists on the registry | Bump the version and try again |
| `E500` / `ECONNRESET` | npm registry outage or network issue | Retry later; verify `npm config get registry` points to the official registry |

## Consumer usage

Install:

```sh
# npm
npm install xiaodao-editor

# pnpm
pnpm add xiaodao-editor

# yarn
yarn add xiaodao-editor
```

Basic usage:

```ts
import { BlockEditor, BuiltinExtensions } from 'xiaodao-editor';
import 'xiaodao-editor/style.css';
```

`peerDependencies` require the consumer project to have `vue@^3.4.0` installed.

## Key files reference

| File | Purpose |
|------|---------|
| `package.json` | `name` / `version` / `files` / `exports` / `publishConfig` / `prepublishOnly` |
| `vite.config.ts` | Library build config: lib entry, ES+UMD outputs, `vue` external, `dts` type generation |
| `tsconfig.json` | Type checking (the `build` script runs `vue-tsc --noEmit` first) |
| `src/index.ts` | Public API barrel — controls which symbols are exported to consumers |
| `dist/` | Build output (shipped in the package, not committed to git) |
