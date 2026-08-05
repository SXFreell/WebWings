# Standalone Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all WebWings settings and first-bind coordination from the transient popup into a persistent Chrome extension options page.

**Architecture:** The popup remains the bookmark manager and delegates its Settings action to `chrome.runtime.openOptionsPage()`. A new Vite/Manifest options entry renders `OptionsApp`, which owns the settings-only IndexedDB reads, full export, root import dialog, and the existing `SettingsView`/`SyncSettingsView` components. The existing persisted `BindSessionRecord` is therefore rendered in a page that remains alive during downloads.

**Tech Stack:** React 19, TypeScript, Vite multi-entry build, Chrome Manifest V3, IndexedDB, Vitest, Testing Library.

## Global Constraints

- Chrome popup behavior must not be overridden; `options.html` is the durable workflow surface.
- Backup success remains gated on `chrome.downloads` reporting `complete`; do not mark a session downloaded before that event.
- All settings currently available in popup must appear in the options page: sync, first-bind, admin Keys, full import, full export, and data counts.
- Popup settings action uses `chrome.runtime.openOptionsPage()` only when the Chrome API is available.
- No raw `srkey` may be persisted or exposed in new state.

---

### Task 1: Add a testable settings-page opener and remove in-popup settings routing

**Files:**
- Modify: `src/lib/browser.ts`
- Modify: `src/App.tsx`
- Create: `src/lib/browser.test.ts`

**Interfaces:**
- Produces `openSettingsPage(): void`, which calls `chrome.runtime.openOptionsPage()` when available and is safe in browser-test fallback contexts.
- `App` consumes `openSettingsPage` for its sidebar Settings button and no longer renders `SettingsView`.

- [ ] **Step 1: Write the failing helper test**

```ts
it('opens the Chrome extension options page', () => {
  const openOptionsPage = vi.fn()
  vi.stubGlobal('chrome', { runtime: { openOptionsPage } })

  openSettingsPage()

  expect(openOptionsPage).toHaveBeenCalledOnce()
})
```

Also add a test where `chrome` is absent and assert `openSettingsPage()` does not throw. The production mutation that this test catches is passing the popup URL or merely changing local React state instead of opening the registered options page.

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `pnpm exec vitest run src/lib/browser.test.ts`

Expected: FAIL because `openSettingsPage` is not exported.

- [ ] **Step 3: Implement the minimal helper and popup migration**

```ts
export const openSettingsPage = (): void => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
    void chrome.runtime.openOptionsPage()
  }
}
```

In `App.tsx`, remove `activeView`, `SettingsView`, full-export helpers, and the root import dialog state that only served popup settings. Keep folder-specific import/export. Wire the sidebar button to `openSettingsPage`, keep its accessible text `设置`, and always render `BookmarksView` in the popup main region.

- [ ] **Step 4: Run the focused test and type/build check**

Run: `pnpm exec vitest run src/lib/browser.test.ts && pnpm build`

Expected: PASS; popup and background assets build successfully.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/browser.ts src/lib/browser.test.ts src/App.tsx
git commit -m "feat(popup): open settings in options page"
```

### Task 2: Create the persistent settings application

**Files:**
- Create: `src/OptionsApp.tsx`
- Create: `src/OptionsApp.test.tsx`
- Create: `src/options.tsx`
- Create: `options.html`
- Modify: `src/components/bookmarks/SettingsView.tsx` only if responsive page sizing/header semantics require it
- Modify: `vite.config.ts`

**Interfaces:**
- `OptionsApp` reads `getAllNodes()` and passes folder/bookmark counts to `SettingsView`.
- `OptionsApp` supplies `onExportAll()` using `exportBookmarks()` and browser download, and `onImport()` opens `ImportDialog` with all current folders and root selected.
- `options.tsx` mounts `OptionsApp` to `#root`; `options.html` loads `src/options.tsx`.

- [ ] **Step 1: Write the failing options-page rendering test**

```tsx
render(<OptionsApp />)

await waitFor(() => expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy())
expect(screen.getByText('云端同步')).toBeTruthy()
expect(screen.getByText('数据管理')).toBeTruthy()
expect(screen.getByText('2 个目录，3 条收藏')).toBeTruthy()
```

Seed IndexedDB with two folders and three bookmarks before render. Add an interaction test that clicks `导入` and verifies the Import dialog is open with the root target. The production mutations this catches are mounting the popup app, omitting `SyncSettingsView`, or deriving counts from stale popup state.

- [ ] **Step 2: Run the options-page test to verify it fails**

Run: `pnpm exec vitest run src/OptionsApp.test.tsx`

Expected: FAIL because `OptionsApp` does not exist.

- [ ] **Step 3: Implement `OptionsApp` and its entry page**

Implement `OptionsApp` with these state values:

```ts
const [nodes, setNodes] = useState<FavoriteNode[]>([])
const [importOpen, setImportOpen] = useState(false)
const folders = useMemo(
  () => nodes.filter((node): node is FolderNode => node.type === 'folder'),
  [nodes],
)
const bookmarkCount = nodes.filter((node) => node.type === 'bookmark').length
```

Reload `nodes` on mount and `onLocalChange`. Implement full export using `exportBookmarks()` and a JSON Blob download named `webwings-bookmarks-YYYY-MM-DD.json`. Implement import through `mergeImport(payload, null)`, then reload. Render `SettingsView` and `ImportDialog`; keep all connection/first-bind behavior inside the existing `SyncSettingsView` used by `SettingsView`. Create `options.html` with a root element and module script `/src/options.tsx`; mount `OptionsApp` from `options.tsx` with the same global styles and `StrictMode` as `main.tsx`. Add `options: 'options.html'` to `rollupOptions.input` in `vite.config.ts`, retaining the existing output rule where only the service worker is emitted as `background.js`.

- [ ] **Step 4: Run the options-page test and build**

Run: `pnpm exec vitest run src/OptionsApp.test.tsx && pnpm build`

Expected: PASS; `dist/options.html` exists and loads a generated entry asset.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/OptionsApp.tsx src/OptionsApp.test.tsx src/options.tsx options.html src/components/bookmarks/SettingsView.tsx vite.config.ts
git commit -m "feat(settings): add persistent options page"
```

### Task 3: Register the options page in the extension manifest and verify the end-to-end artifact

**Files:**
- Modify: `public/manifest.json`
- Test: `src/OptionsApp.test.tsx`

**Interfaces:**
- Manifest produces `options_ui: { page: 'options.html', open_in_tab: true }`.
- Vite already produces entries for `popup`, `options`, and `background`; only `background.js` is the service-worker filename.

- [ ] **Step 1: Write the failing build-artifact assertion**

Add a build verification command that reads generated `dist/manifest.json` and asserts the parsed `options_ui.page` equals `options.html`, then asserts `dist/options.html` exists:

```bash
pnpm build
node -e "const fs=require('node:fs'); const manifest=JSON.parse(fs.readFileSync('dist/manifest.json','utf8')); if (manifest.options_ui?.page !== 'options.html' || !fs.existsSync('dist/options.html')) process.exit(1)"
```

The production mutation this catches is adding a React page but not registering it in the extension artifact.

- [ ] **Step 2: Run the artifact assertion to verify it fails**

Run the command above before the manifest/Vite changes.

Expected: FAIL because `dist/manifest.json` has no `options_ui` (while `dist/options.html` already exists from Task 2).

- [ ] **Step 3: Add the manifest and Vite entries**

Add this Manifest field adjacent to `action`:

```json
"options_ui": {
  "page": "options.html",
  "open_in_tab": true
}
```

Keep the Task 2 Vite entry unchanged. The existing output naming rule emits only the service worker as `background.js` and keeps page assets hashed.

- [ ] **Step 4: Run all verification**

Run: `pnpm verify && node -e "const fs=require('node:fs'); const manifest=JSON.parse(fs.readFileSync('dist/manifest.json','utf8')); if (manifest.options_ui?.page !== 'options.html' || !fs.existsSync('dist/options.html')) process.exit(1)" && git diff --check`

Expected: full suite passes, PostgreSQL test remains skipped without `DATABASE_URL`, and the built extension includes the registered options page.

- [ ] **Step 5: Manual Chrome acceptance and commit**

1. In `chrome://extensions`, reload the unpacked `dist` extension.
2. Open the popup and click `设置`; verify an extension settings tab opens.
3. Start first bind, save the ZIP from the native dialog, and verify the tab stays open and advances to `记录备份凭证` without a second download.
4. Verify full export and root import remain available in the settings tab.

```bash
git add public/manifest.json
git commit -m "feat(extension): register options settings page"
```
