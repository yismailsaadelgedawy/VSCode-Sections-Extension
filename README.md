# MATLAB Style Sections (VS Code)

Provides MATLAB-like section headers using `%%` across many languages.

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

## Showcase

### C/C++ Sections

<img src="showcase_images/cpp.png" alt="C/C++ sections" width="700" />

### Hierarchy

<img src="showcase_images/cpp_heirarchy.png" alt="C/C++ hierarchy" width="700" />

### Verilog Sections

<img src="showcase_images/Verilog.png" alt="Verilog sections" width="700" />

### Python Sections

<img src="showcase_images/Python.png" alt="Python sections" width="700" />

### SQL Sections

<img src="showcase_images/SQL.png" alt="SQL sections" width="700" />

### JavaScript Sections

<img src="showcase_images/JS.png" alt="JavaScript sections" width="700" />

### INI Sections

<img src="showcase_images/INI.png" alt="INI sections" width="700" />

### Even Plain Text!

<img src="showcase_images/TXT.png" alt="Plain text sections" width="700" />
