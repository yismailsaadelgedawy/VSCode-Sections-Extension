import * as vscode from 'vscode';

type Section = {
  headerLine: number;
  headerIndent: number;
  title: string;
  titleStart: number;
  titleEnd: number;
  contentStart: number;
  foldEnd: number;
};

const SECTION_RE = /^\s*(?:\/\/|#|;|--|\/\*+|\*|<!--)?\s*%%(?:\s+(.*?))?\s*(?:\*\/|-->)?\s*$/;

export function activate(context: vscode.ExtensionContext): void {
  const controller = new SectionController();

  context.subscriptions.push(
    controller,
    vscode.languages.registerFoldingRangeProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }],
      controller
    ),
    vscode.languages.registerDocumentSymbolProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }],
      controller,
      { label: 'Sections' }
    ),
    vscode.window.onDidChangeActiveTextEditor(() => controller.refreshAllVisibleEditors()),
    vscode.window.onDidChangeTextEditorSelection((event) => controller.onSelectionChanged(event)),
    vscode.workspace.onDidChangeTextDocument((event) => controller.onDocumentChanged(event)),
    vscode.workspace.onDidCloseTextDocument((doc) => controller.clearCache(doc.uri.toString())),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('matlabSections')) {
        controller.refreshAllVisibleEditors();
      }
    })
  );

  controller.refreshAllVisibleEditors();
}

export function deactivate(): void {
  // No-op. Disposables are handled via extension context.
}

class SectionController
  implements vscode.Disposable, vscode.FoldingRangeProvider, vscode.DocumentSymbolProvider
{
  private readonly boldHeaderDecoration = vscode.window.createTextEditorDecorationType({
    fontWeight: '700',
    letterSpacing: '0.1px'
  });

  private readonly dividerDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderWidth: '1px 0 0 0',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor('editorIndentGuide.activeBackground'),
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    after: {
      contentText: ''
    }
  });

  private readonly activeDividerDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderWidth: '1px 0 0 0',
    borderStyle: 'solid',
    borderColor: '#29A8FF',
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    after: {
      contentText: ''
    }
  });

  private readonly sectionsByDoc = new Map<string, Section[]>();

  dispose(): void {
    this.boldHeaderDecoration.dispose();
    this.dividerDecoration.dispose();
    this.activeDividerDecoration.dispose();
    this.sectionsByDoc.clear();
  }

  provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FoldingRange[]> {
    if (!this.isEnabled() || this.isExcludedFile(document)) {
      return undefined;
    }

    const sections = this.getSections(document);
    const sectionRanges = sections
      .filter((section) => section.foldEnd > section.headerLine)
      .map(
        (section) =>
          new vscode.FoldingRange(
            section.headerLine,
            section.foldEnd,
            vscode.FoldingRangeKind.Region
          )
      );

    const indentRanges = this.computeIndentationFolds(document);
    return this.mergeFoldingRanges(sectionRanges, indentRanges);
  }

  provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    if (!this.isEnabled() || this.isExcludedFile(document)) {
      return undefined;
    }

    const sections = this.getSections(document);
    const containers = this.detectContainerSymbols(document);
    if (document.lineCount === 0) {
      return containers.length > 0 ? containers : undefined;
    }

    const sectionSymbols = sections.map((section) => {
      const endLine = Math.min(section.foldEnd, document.lineCount - 1);
      const endChar = document.lineAt(endLine).text.length;
      const range = new vscode.Range(section.headerLine, 0, endLine, endChar);
      const selectionRange = new vscode.Range(
        section.headerLine,
        section.titleStart,
        section.headerLine,
        section.titleEnd
      );
      return new vscode.DocumentSymbol(
        section.title,
        '',
        vscode.SymbolKind.Object,
        range,
        selectionRange
      );
    });

    const merged = this.buildHierarchy([...containers, ...sectionSymbols]);
    return merged.length > 0 ? merged : undefined;
  }

  onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    this.sectionsByDoc.delete(event.document.uri.toString());
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === event.document.uri.toString()) {
        this.applyDecorations(editor);
      }
    }
  }

  clearCache(uri: string): void {
    this.sectionsByDoc.delete(uri);
  }

  onSelectionChanged(event: vscode.TextEditorSelectionChangeEvent): void {
    if (event.textEditor === vscode.window.activeTextEditor) {
      this.applyDecorations(event.textEditor);
    }
  }

  refreshActiveEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.applyDecorations(editor);
    }
  }

  refreshAllVisibleEditors(): void {
    this.sectionsByDoc.clear();
    for (const editor of vscode.window.visibleTextEditors) {
      this.applyDecorations(editor);
    }
  }

  private applyDecorations(editor: vscode.TextEditor): void {
    if (!this.isEnabled() || this.isExcludedFile(editor.document)) {
      editor.setDecorations(this.boldHeaderDecoration, []);
      editor.setDecorations(this.dividerDecoration, []);
      editor.setDecorations(this.activeDividerDecoration, []);
      return;
    }

    const sections = this.getSections(editor.document);
    const enableHeaderStyle = vscode.workspace
      .getConfiguration('matlabSections')
      .get<boolean>('decorateHeader', true);
    const showDivider = vscode.workspace
      .getConfiguration('matlabSections')
      .get<boolean>('showDivider', true);

    const boldRanges: vscode.DecorationOptions[] = [];
    const dividerLineNumbers = new Set<number>();
    const activeDividerLineNumbers = new Set<number>();
    const implicitEndLines = showDivider
      ? this.computeImplicitSectionEndLines(editor.document, sections)
      : new Map<number, number>();

    if (showDivider && editor === vscode.window.activeTextEditor) {
      const cursorLine = editor.selection.active.line;
      const activeIndex = sections.findIndex(
        (section) => cursorLine >= section.headerLine && cursorLine <= section.foldEnd
      );

      if (activeIndex >= 0) {
        activeDividerLineNumbers.add(sections[activeIndex].headerLine);
        const implicitEndLine = implicitEndLines.get(sections[activeIndex].headerLine);
        if (implicitEndLine !== undefined) {
          activeDividerLineNumbers.add(implicitEndLine);
        }
        if (activeIndex + 1 < sections.length) {
          activeDividerLineNumbers.add(sections[activeIndex + 1].headerLine);
        }
      }
    }

    for (const section of sections) {
      if (enableHeaderStyle) {
        boldRanges.push({
          range: new vscode.Range(
            new vscode.Position(section.headerLine, section.titleStart),
            new vscode.Position(section.headerLine, section.titleEnd)
          )
        });
      }

      if (showDivider) {
        if (activeDividerLineNumbers.has(section.headerLine)) {
          activeDividerLineNumbers.add(section.headerLine);
        } else {
          dividerLineNumbers.add(section.headerLine);
        }

        const implicitEndLine = implicitEndLines.get(section.headerLine);
        if (implicitEndLine !== undefined) {
          if (activeDividerLineNumbers.has(implicitEndLine)) {
            activeDividerLineNumbers.add(implicitEndLine);
          } else {
            dividerLineNumbers.add(implicitEndLine);
          }
        }
      }
    }

    for (const lineNumber of activeDividerLineNumbers) {
      dividerLineNumbers.delete(lineNumber);
    }

    const dividerRanges = [...dividerLineNumbers].map((lineNumber) => editor.document.lineAt(lineNumber).range);
    const activeDividerRanges = [...activeDividerLineNumbers].map((lineNumber) =>
      editor.document.lineAt(lineNumber).range
    );

    editor.setDecorations(this.boldHeaderDecoration, boldRanges);
    editor.setDecorations(this.dividerDecoration, dividerRanges);
    editor.setDecorations(this.activeDividerDecoration, activeDividerRanges);
  }

  private computeImplicitSectionEndLines(
    document: vscode.TextDocument,
    sections: Section[]
  ): Map<number, number> {
    if (sections.length === 0 || document.lineCount === 0) {
      return new Map<number, number>();
    }

    const containers = this.detectContainerSymbols(document)
      .filter((symbol) => symbol.range.end.line > symbol.range.start.line)
      .sort((a, b) => {
        const spanA = a.range.end.line - a.range.start.line;
        const spanB = b.range.end.line - b.range.start.line;
        return spanA - spanB;
      });

    const implicitEnds = new Map<number, number>();
    if (containers.length === 0) {
      return implicitEnds;
    }

    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i];
      const container = containers.find(
        (candidate) =>
          section.headerLine >= candidate.range.start.line && section.headerLine < candidate.range.end.line
      );
      if (!container) {
        continue;
      }

      const nextSection = sections[i + 1];
      if (nextSection && nextSection.headerLine <= container.range.end.line) {
        continue;
      }

      const endLine = container.range.end.line;
      if (endLine > section.headerLine && endLine < document.lineCount) {
        implicitEnds.set(section.headerLine, endLine);
      }
    }

    return implicitEnds;
  }

  private getSections(document: vscode.TextDocument): Section[] {
    const key = document.uri.toString();
    const cached = this.sectionsByDoc.get(key);
    if (cached) {
      return cached;
    }

    const sections = this.parseSections(document);
    this.sectionsByDoc.set(key, sections);
    return sections;
  }

  private parseSections(document: vscode.TextDocument): Section[] {
    const headers: Section[] = [];

    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
      const text = document.lineAt(lineNumber).text;
      const match = text.match(SECTION_RE);
      if (!match) {
        continue;
      }

      const markerIndex = text.indexOf('%%');
      if (markerIndex < 0) {
        continue;
      }

      const title = this.sectionTitle(text, markerIndex);
      const titleStart = markerIndex;
      const titleEnd = text.trimEnd().length;
      const indent = this.leadingWhitespace(text);

      headers.push({
        headerLine: lineNumber,
        headerIndent: indent,
        title,
        titleStart,
        titleEnd,
        contentStart: lineNumber + 1,
        foldEnd: lineNumber + 1
      });
    }

    const indentAware = vscode.workspace
      .getConfiguration('matlabSections')
      .get<boolean>('indentAware', true);

    for (let i = 0; i < headers.length; i += 1) {
      const current = headers[i];
      const nextHeader = headers[i + 1];
      const maxEnd = nextHeader ? nextHeader.headerLine - 1 : document.lineCount - 1;
      let foldEnd = maxEnd;

      if (indentAware) {
        for (let lineNumber = current.contentStart; lineNumber <= maxEnd; lineNumber += 1) {
          const lineText = document.lineAt(lineNumber).text;
          if (lineText.trim().length === 0) {
            continue;
          }

          const indent = this.leadingWhitespace(lineText);
          if (indent < current.headerIndent) {
            foldEnd = lineNumber - 1;
            break;
          }
        }
      }

      current.foldEnd = Math.max(current.contentStart, foldEnd);
    }

    return headers;
  }

  private leadingWhitespace(text: string): number {
    let count = 0;
    while (count < text.length) {
      const ch = text[count];
      if (ch !== ' ' && ch !== '\t') {
        break;
      }
      count += 1;
    }
    return count;
  }

  private isEnabled(): boolean {
    return vscode.workspace.getConfiguration('matlabSections').get<boolean>('enabled', true);
  }

  private isExcludedFile(document: vscode.TextDocument): boolean {
    const path = document.uri.fsPath.toLowerCase();
    return path.endsWith('.m');
  }

  private sectionTitle(text: string, markerIndex: number): string {
    const raw = text.slice(markerIndex + 2).replace(/\s*(\*\/|-->)\s*$/, '').trim();
    return raw.length > 0 ? raw : 'Section';
  }

  private detectContainerSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const symbols: vscode.DocumentSymbol[] = [];
    const topLevelDefines: vscode.DocumentSymbol[] = [];
    const topLevelAliases: vscode.DocumentSymbol[] = [];
    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
      const text = document.lineAt(lineNumber).text;
      const trimmed = text.trim();
      if (
        trimmed.length === 0 ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
      ) {
        continue;
      }

      const define = this.matchDefine(text);
      if (define) {
        topLevelDefines.push(
          new vscode.DocumentSymbol(
            define.name,
            '',
            vscode.SymbolKind.Constant,
            new vscode.Range(lineNumber, 0, lineNumber, text.length),
            new vscode.Range(lineNumber, define.startChar, lineNumber, define.startChar + define.name.length)
          )
        );
        continue;
      }

      const alias = this.matchTypeAlias(text);
      if (alias) {
        topLevelAliases.push(
          new vscode.DocumentSymbol(
            alias.name,
            'type alias',
            vscode.SymbolKind.TypeParameter,
            new vscode.Range(lineNumber, 0, lineNumber, text.length),
            new vscode.Range(lineNumber, alias.startChar, lineNumber, alias.startChar + alias.name.length)
          )
        );
        continue;
      }

      const functionDef = this.matchFunctionDefinition(text);
      if (functionDef) {
        let blockStartLine = lineNumber;
        if (!functionDef.hasBrace) {
          const nextLine = this.findNextNonEmptyLine(document, lineNumber + 1);
          if (nextLine < 0 || document.lineAt(nextLine).text.trim() !== '{') {
            continue;
          }
          blockStartLine = nextLine;
        }

        const endLine = this.findBlockEndLine(document, blockStartLine);
        symbols.push(
          new vscode.DocumentSymbol(
            functionDef.displayName,
            '',
            vscode.SymbolKind.Function,
            new vscode.Range(lineNumber, 0, endLine, document.lineAt(endLine).text.length),
            new vscode.Range(lineNumber, 0, lineNumber, text.length)
          )
        );
        continue;
      }

      const functionDecl = this.matchFunctionDeclaration(text);
      if (functionDecl) {
        if (this.isInsideAnyContainer(symbols, lineNumber)) {
          continue;
        }
        const startChar = text.indexOf(functionDecl.displayName);
        symbols.push(
          new vscode.DocumentSymbol(
            functionDecl.displayName,
            'declaration',
            vscode.SymbolKind.Function,
            new vscode.Range(lineNumber, 0, lineNumber, text.length),
            new vscode.Range(lineNumber, Math.max(0, startChar), lineNumber, Math.max(0, startChar) + functionDecl.displayName.length)
          )
        );
        continue;
      }

      const typeBlock = this.matchTypeBlockStart(text);
      if (typeBlock) {
        let blockStartLine = lineNumber;
        if (!typeBlock.hasBrace) {
          const nextLine = this.findNextNonEmptyLine(document, lineNumber + 1);
          if (nextLine < 0 || document.lineAt(nextLine).text.trim() !== '{') {
            continue;
          }
          blockStartLine = nextLine;
        }

        const endLine = this.findBlockEndLine(document, blockStartLine);
        symbols.push(
          new vscode.DocumentSymbol(
            typeBlock.displayName,
            '',
            typeBlock.kind,
            new vscode.Range(lineNumber, 0, endLine, document.lineAt(endLine).text.length),
            new vscode.Range(lineNumber, 0, lineNumber, text.length)
          )
        );
        continue;
      }

      const verilogModule = text.match(/^\s*module\s+([A-Za-z_]\w*)/);
      if (verilogModule) {
        const endLine = this.findRegexEndLine(document, lineNumber, /^\s*endmodule\b/);
        symbols.push(
          new vscode.DocumentSymbol(
            verilogModule[1],
            '',
            vscode.SymbolKind.Module,
            new vscode.Range(lineNumber, 0, endLine, document.lineAt(endLine).text.length),
            new vscode.Range(lineNumber, 0, lineNumber, text.length)
          )
        );
      }
    }

    const globalVars = this.detectGlobalVariables(document, symbols);
    return [...symbols, ...globalVars, ...topLevelAliases, ...topLevelDefines];
  }

  private matchTypeAlias(text: string):
    | { name: string; startChar: number }
    | undefined {
    const match = text.match(/^\s*using\s+([A-Za-z_]\w*)\s*=\s*.+;\s*$/);
    if (!match) {
      return undefined;
    }

    const name = match[1];
    const startChar = text.indexOf(name);
    if (startChar < 0) {
      return undefined;
    }

    return { name, startChar };
  }

  private matchDefine(text: string):
    | { name: string; startChar: number }
    | undefined {
    const match = text.match(/^\s*#\s*define\s+([A-Za-z_]\w*)\b/);
    if (!match) {
      return undefined;
    }

    const name = match[1];
    const startChar = text.indexOf(name);
    if (startChar < 0) {
      return undefined;
    }

    return { name, startChar };
  }

  private matchFunctionDefinition(text: string):
    | { displayName: string; hasBrace: boolean }
    | undefined {
    const match = text.match(
      /^\s*(?:template\s*<[^>]+>\s*)?(?:[\w:\<\>\~\*&]+\s+)+([A-Za-z_]\w*(?:::[A-Za-z_]\w*)?)\s*\(([^;{}()]*)\)\s*(?:const\s*)?(?:noexcept\s*)?(\{)?\s*$/
    );
    if (!match) {
      return undefined;
    }

    const name = match[1];
    if (this.isControlKeyword(name)) {
      return undefined;
    }

    const params = this.normalizeParams(match[2]);
    return {
      displayName: `${name}(${params})`,
      hasBrace: Boolean(match[3])
    };
  }

  private matchFunctionDeclaration(text: string):
    | { displayName: string }
    | undefined {
    const match = text.match(
      /^\s*(?:template\s*<[^>]+>\s*)?(?:[\w:\<\>\~\*&]+\s+)+([A-Za-z_]\w*(?:::[A-Za-z_]\w*)?)\s*\(([^{}()]*)\)\s*(?:const\s*)?(?:noexcept\s*)?(?:=\s*0\s*)?;\s*$/
    );
    if (!match) {
      return undefined;
    }

    const name = match[1];
    if (this.isControlKeyword(name)) {
      return undefined;
    }

    const params = this.normalizeParams(match[2]);
    return { displayName: `${name}(${params})` };
  }

  private matchTypeBlockStart(text: string):
    | { displayName: string; hasBrace: boolean; kind: vscode.SymbolKind }
    | undefined {
    const namespaceMatch = text.match(/^\s*namespace\s+([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*(\{)?\s*$/);
    if (namespaceMatch) {
      return {
        displayName: namespaceMatch[1],
        hasBrace: Boolean(namespaceMatch[2]),
        kind: vscode.SymbolKind.Namespace
      };
    }

    const aggregateMatch = text.match(
      /^\s*(typedef\s+)?(struct|class|union|enum)(?:\s+(class|struct))?(?:\s+([A-Za-z_]\w*))?\s*(\{)?\s*$/
    );
    if (!aggregateMatch) {
      return undefined;
    }

    const isTypedef = Boolean(aggregateMatch[1]);
    const kindToken = aggregateMatch[2];
    const scopedEnumToken = aggregateMatch[3];
    const name = aggregateMatch[4];
    const hasBrace = Boolean(aggregateMatch[5]);
    const descriptor = scopedEnumToken ? `${kindToken} ${scopedEnumToken}` : kindToken;
    const displayName = name ? `${descriptor} ${name}` : descriptor;

    let symbolKind = vscode.SymbolKind.Struct;
    if (kindToken === 'class') {
      symbolKind = vscode.SymbolKind.Class;
    } else if (kindToken === 'enum') {
      symbolKind = vscode.SymbolKind.Enum;
    } else if (kindToken === 'union') {
      symbolKind = vscode.SymbolKind.Struct;
    }

    return {
      displayName: isTypedef ? `typedef ${displayName}` : displayName,
      hasBrace,
      kind: symbolKind
    };
  }

  private normalizeParams(raw: string): string {
    const params = raw.trim().replace(/\s+/g, ' ');
    return params.length > 0 ? params : 'void';
  }

  private isControlKeyword(name: string): boolean {
    return (
      name === 'if' ||
      name === 'for' ||
      name === 'while' ||
      name === 'switch' ||
      name === 'catch'
    );
  }

  private detectGlobalVariables(
    document: vscode.TextDocument,
    containers: vscode.DocumentSymbol[]
  ): vscode.DocumentSymbol[] {
    const globals: vscode.DocumentSymbol[] = [];
    const globalVarRe =
      /^\s*(?:static\s+|extern\s+|const\s+|volatile\s+|unsigned\s+|signed\s+|short\s+|long\s+|register\s+|auto\s+|mutable\s+|constexpr\s+|inline\s+)*[A-Za-z_]\w*(?:\s*[*&]\s*|\s+)+([A-Za-z_]\w*)\s*(?:=\s*[^;]+)?;\s*$/;

    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
      if (this.isInsideAnyContainer(containers, lineNumber)) {
        continue;
      }

      const text = document.lineAt(lineNumber).text;
      if (text.trim().length === 0 || text.trimStart().startsWith('#')) {
        continue;
      }
      if (text.includes('(')) {
        continue;
      }

      const match = text.match(globalVarRe);
      if (!match) {
        continue;
      }

      const name = match[1];
      const startChar = text.indexOf(name);
      const endChar = startChar + name.length;
      globals.push(
        new vscode.DocumentSymbol(
          name,
          '',
          vscode.SymbolKind.Variable,
          new vscode.Range(lineNumber, 0, lineNumber, text.length),
          new vscode.Range(lineNumber, startChar, lineNumber, endChar)
        )
      );
    }

    return globals;
  }

  private isInsideAnyContainer(containers: vscode.DocumentSymbol[], lineNumber: number): boolean {
    return containers.some(
      (container) => lineNumber >= container.range.start.line && lineNumber <= container.range.end.line
    );
  }

  private findBlockEndLine(document: vscode.TextDocument, startLine: number): number {
    let depth = 0;
    for (let lineNumber = startLine; lineNumber < document.lineCount; lineNumber += 1) {
      const text = document.lineAt(lineNumber).text;
      for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '{') {
          depth += 1;
        } else if (text[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            return lineNumber;
          }
        }
      }
    }
    return document.lineCount - 1;
  }

  private findRegexEndLine(
    document: vscode.TextDocument,
    startLine: number,
    endPattern: RegExp
  ): number {
    for (let lineNumber = startLine + 1; lineNumber < document.lineCount; lineNumber += 1) {
      if (endPattern.test(document.lineAt(lineNumber).text)) {
        return lineNumber;
      }
    }
    return document.lineCount - 1;
  }

  private buildHierarchy(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
    const sorted = [...symbols].sort((a, b) => {
      const startDelta = a.range.start.line - b.range.start.line;
      if (startDelta !== 0) {
        return startDelta;
      }
      const spanA = a.range.end.line - a.range.start.line;
      const spanB = b.range.end.line - b.range.start.line;
      return spanB - spanA;
    });

    for (const symbol of sorted) {
      symbol.children = [];
    }

    const roots: vscode.DocumentSymbol[] = [];
    for (let i = 0; i < sorted.length; i += 1) {
      const child = sorted[i];
      let bestParentIndex = -1;
      let bestSpan = Number.POSITIVE_INFINITY;

      for (let j = 0; j < sorted.length; j += 1) {
        if (i === j) {
          continue;
        }

        const parent = sorted[j];
        if (!this.strictlyContains(parent.range, child.range)) {
          continue;
        }

        const span = parent.range.end.line - parent.range.start.line;
        if (span < bestSpan) {
          bestSpan = span;
          bestParentIndex = j;
        }
      }

      if (bestParentIndex >= 0) {
        sorted[bestParentIndex].children.push(child);
      } else {
        roots.push(child);
      }
    }

    return roots;
  }

  private strictlyContains(parent: vscode.Range, child: vscode.Range): boolean {
    const startsBeforeOrEqual =
      parent.start.line < child.start.line ||
      (parent.start.line === child.start.line && parent.start.character <= child.start.character);
    const endsAfterOrEqual =
      parent.end.line > child.end.line ||
      (parent.end.line === child.end.line && parent.end.character >= child.end.character);
    const notEqualRange =
      parent.start.line !== child.start.line ||
      parent.start.character !== child.start.character ||
      parent.end.line !== child.end.line ||
      parent.end.character !== child.end.character;

    return startsBeforeOrEqual && endsAfterOrEqual && notEqualRange;
  }

  private computeIndentationFolds(document: vscode.TextDocument): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];
    const stack: Array<{ line: number; indent: number }> = [];

    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
      const text = document.lineAt(lineNumber).text;
      if (text.trim().length === 0) {
        continue;
      }

      const indent = this.leadingWhitespace(text);

      while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
        const start = stack.pop();
        if (!start) {
          break;
        }

        const end = lineNumber - 1;
        if (end > start.line) {
          ranges.push(new vscode.FoldingRange(start.line, end));
        }
      }

      const nextNonEmpty = this.findNextNonEmptyLine(document, lineNumber + 1);
      if (nextNonEmpty < 0) {
        continue;
      }

      const nextIndent = this.leadingWhitespace(document.lineAt(nextNonEmpty).text);
      if (nextIndent > indent) {
        stack.push({ line: lineNumber, indent });
      }
    }

    const lastLine = document.lineCount - 1;
    while (stack.length > 0) {
      const start = stack.pop();
      if (!start) {
        break;
      }

      if (lastLine > start.line) {
        ranges.push(new vscode.FoldingRange(start.line, lastLine));
      }
    }

    return ranges;
  }

  private findNextNonEmptyLine(document: vscode.TextDocument, from: number): number {
    for (let lineNumber = from; lineNumber < document.lineCount; lineNumber += 1) {
      if (document.lineAt(lineNumber).text.trim().length > 0) {
        return lineNumber;
      }
    }
    return -1;
  }

  private mergeFoldingRanges(
    sectionRanges: vscode.FoldingRange[],
    indentRanges: vscode.FoldingRange[]
  ): vscode.FoldingRange[] {
    const all = [...sectionRanges, ...indentRanges];
    const seen = new Set<string>();
    const merged: vscode.FoldingRange[] = [];

    for (const range of all) {
      const key = `${range.start}:${range.end}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(range);
    }

    merged.sort((a, b) => (a.start === b.start ? a.end - b.end : a.start - b.start));
    return merged;
  }
}
