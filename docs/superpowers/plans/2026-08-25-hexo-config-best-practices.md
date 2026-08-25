# Hexo Configuration Best Practices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Hexo 8 site configuration explicit, correctly scoped, dependency-complete, and verifiably functional from a clean checkout.

**Architecture:** Keep Hexo core and generator settings in the site `_config.yml`; keep AirCloud-only settings in the theme `_config.yml`; make templates consume each configuration through the matching `config` or `theme` object. Verify the public-site contract after a clean generation instead of accepting a warning-free build as proof.

**Tech Stack:** Hexo 8, EJS, YAML, Node.js 24 LTS, npm

**Spec:** The current task request to re-audit `/Users/luckybear/Project/blog` and repair its Hexo configuration using current Hexo best practices.

## Global Constraints

- Preserve the current production URL and permalink scheme.
- Keep AirCloud as the active vendored theme.
- Use Hexo's built-in post-asset support instead of a duplicate asset-rewriting plugin.
- Do not retain legacy and replacement configuration paths in parallel.
- A clean generation and output-contract test must pass before completion.

---

### Task 1: Add a public-site contract test

**Files:**
- Modify: `test/check-internal-links.js`
- Modify: `package.json`
- Modify: `README.md`
- Create: `.node-version`

**Interfaces:**
- Consumes: files generated below `public/` by `hexo generate`
- Produces: one test command that rejects missing search output, comments, metadata, favicon, safe external links, and post assets

- [x] **Step 1: Add assertions for each currently broken public behavior**
- [x] **Step 2: Run the test against the current generated site**

Run: `node test/check-internal-links.js`

Expected: FAIL first because `search.json`, Giscus, the favicon target, safe external-link attributes, and standard keywords metadata are not all present.

### Task 2: Separate site and theme configuration

**Files:**
- Modify: `_config.yml`
- Delete: `_config.landscape.yml`
- Modify: `themes/aircloud/_config.yml`
- Modify: `themes/aircloud/layout/**/*.ejs`

**Interfaces:**
- Consumes: Hexo's `config` global and the AirCloud `theme` global
- Produces: typed Hexo 8 options and a single AirCloud configuration source

- [x] **Step 1: Replace deprecated or null-valued Hexo settings with current typed settings**
- [x] **Step 2: Move AirCloud-only values to its theme configuration**
- [x] **Step 3: Update templates to read theme-only values through `theme` and standard site metadata through `config`**
- [x] **Step 4: Render Giscus through AirCloud's documented `comment.script` contract**

### Task 3: Complete and simplify the dependency graph

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `source/_posts/RTX 5090 推理 Qwen3.6-27B 基准 112 tok.md`

**Interfaces:**
- Consumes: `search` and `marked.postAsset` configuration
- Produces: `public/search.json` and correct post-local image URLs without a rewriting plugin

- [x] **Step 1: Add `hexo-generator-search`**
- [x] **Step 2: Remove plugins and direct dependencies that have no valid consumer**
- [x] **Step 3: Convert the four plugin-specific image links to native post-asset links**
- [x] **Step 4: Regenerate the npm lockfile from `package.json`**

### Task 4: Verify the clean site

**Files:**
- Test: `test/check-internal-links.js`

**Interfaces:**
- Consumes: the complete repository state
- Produces: fresh evidence that installation, generation, and user-visible configuration are consistent

- [x] **Step 1: Run `npm install --package-lock-only` and `npm ls --depth=0`**
- [x] **Step 2: Run `npm test` from a clean generated-output state**
- [x] **Step 3: Inspect the effective Hexo and AirCloud configurations**
- [x] **Step 4: Review `git diff --check`, the final diff, and repository status**
