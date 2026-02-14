# MATLAB Style Sections (VS Code)

Provides MATLAB-like section headers using `%%` across languages.

## Supported header styles

Any line that looks like a comment plus `%%` is treated as a section header, for example:

- `%% Section Title`
- `// %% Section Title`
- `# %% Section Title`
- `-- %% Section Title`
- `; %% Section Title`

## Features

- Renders a horizontal divider on section header lines across languages.
- Styles section header text (`%% ...`) with strong emphasis.
- Makes each section foldable with the fold chevron on the section header line.
- Exposes `%%` sections in Outline/Breadcrumbs so you can jump via editor symbols.
- Core section rendering works across languages (not tied to one parser).
- Automatically disables itself for `.m` files to avoid conflicts with MATLAB extensions.
- When your cursor is inside a section, only that section's divider lines are highlighted blue.
- Extensive container detection supported for:
- C/C++
- Verilog

## Settings

- `matlabSections.enabled` (default: `true`)
- `matlabSections.decorateHeader` (default: `true`)
- `matlabSections.showDivider` (default: `true`)
- `matlabSections.indentAware` (default: `true`)

## Build

```bash
npm install
npm run compile
```

Then press `F5` in VS Code to run the Extension Development Host.

## Automated Publish (GitHub Actions)

A workflow is included at `.github/workflows/publish.yml`.

- Triggers on tags like `v0.0.2` and on manual dispatch.
- Requires a repository secret named `VSCE_PAT` (your Marketplace Personal Access Token).
- Validates that:
- `package.json.publisher` is not `local`
- tag version matches `package.json.version`

### Typical release flow

1. Update `package.json`:
- set `publisher` to your Marketplace publisher ID
- bump `version`
2. Commit and push.
3. Create and push a tag matching that version:

```bash
git tag v0.0.2
git push origin v0.0.2
```

The workflow will build and publish automatically.

## Build VSIX Only (No PAT Required)

A workflow is included at `.github/workflows/package-vsix.yml`.

- Triggers on pushes to `main` and manual dispatch.
- Builds and packages the extension into a `.vsix`.
- Uploads the `.vsix` as a GitHub Actions artifact named `vscode-extension-vsix`.

### How to use the artifact

1. Open your GitHub repo Actions tab.
2. Run `Build VSIX Artifact` (or use the latest run from `main`).
3. Download artifact `vscode-extension-vsix`.
4. In VS Code, install with `Extensions: Install from VSIX...`.
