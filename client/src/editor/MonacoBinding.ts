import type * as monaco from 'monaco-editor';
import {
  MAX_SELECTION_RANGES,
  OTError,
  type LanguageId,
  type Selection,
  type SelectionRange,
  type TextOperation,
} from '@collab/shared';
import { changesToOperation, operationToEdits } from './opConversion';

type MonacoNamespace = typeof monaco;

export interface MonacoBindingHooks {
  onLocalOperation(op: TextOperation): void;
  /** Debounced 50 ms. */
  onLocalSelection(sel: Selection): void;
}

const SELECTION_DEBOUNCE_MS = 50;

export class MonacoBinding {
  private readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly monacoNs: MonacoNamespace;
  private readonly model: monaco.editor.ITextModel;
  private readonly hooks: MonacoBindingHooks;
  private readonly disposables: monaco.IDisposable[] = [];
  /** True while we are writing server changes into the model, so they aren't echoed back as local edits. */
  private applyingRemote = false;
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(editor: monaco.editor.IStandaloneCodeEditor, monacoNs: MonacoNamespace, hooks: MonacoBindingHooks) {
    const model = editor.getModel();
    if (!model) throw new Error('MonacoBinding: editor has no model');
    this.editor = editor;
    this.monacoNs = monacoNs;
    this.model = model;
    this.hooks = hooks;

    // Every replica must count a line break as one character, or offsets disagree
    // between a Windows user (CRLF) and everyone else.
    this.withRemoteFlag(() => model.setEOL(monacoNs.editor.EndOfLineSequence.LF));

    this.disposables.push(
      editor.onDidChangeModelContent((e) => {
        if (this.applyingRemote) return;
        const delta = e.changes.reduce((sum, c) => sum + c.text.length - c.rangeLength, 0);
        const op = changesToOperation(e.changes, model.getValueLength() - delta);
        if (!op.isNoop()) this.hooks.onLocalOperation(op);
      }),
      editor.onDidChangeCursorSelection(() => {
        // Cursor shifts caused by remote edits are reproduced on every other replica
        // by transforming through the same op, so they need not be sent.
        if (this.applyingRemote) return;
        this.scheduleSelection();
      }),
    );
  }

  /** Full replace as a remote change. Resets the undo stack, which is fine on (re)join. */
  setDocument(text: string): void {
    this.withRemoteFlag(() => {
      this.model.setValue(text);
      this.model.setEOL(this.monacoNs.editor.EndOfLineSequence.LF);
    });
  }

  applyRemote(op: TextOperation): void {
    if (op.baseLength !== this.model.getValueLength()) {
      throw new OTError(
        'LENGTH_MISMATCH',
        `Remote op base length ${op.baseLength} does not match editor length ${this.model.getValueLength()}`,
      );
    }
    // Ranges must be computed against the unmodified model, because applyEdits
    // interprets every range in pre-edit coordinates.
    const edits = operationToEdits(op).map((e) => {
      const start = this.model.getPositionAt(e.offset);
      const end = this.model.getPositionAt(e.offset + e.length);
      return {
        range: new this.monacoNs.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        text: e.text,
      };
    });
    // applyEdits, not executeEdits: other users' edits must not land on the local undo stack.
    this.withRemoteFlag(() => this.model.applyEdits(edits));
  }

  setLanguage(language: LanguageId): void {
    this.monacoNs.editor.setModelLanguage(this.model, language);
  }

  setReadOnly(readOnly: boolean): void {
    this.editor.updateOptions({ readOnly });
  }

  getSelection(): Selection {
    const selections = this.editor.getSelections() ?? [];
    const ranges: SelectionRange[] = selections.slice(0, MAX_SELECTION_RANGES).map((s) => ({
      anchor: this.model.getOffsetAt({ lineNumber: s.selectionStartLineNumber, column: s.selectionStartColumn }),
      head: this.model.getOffsetAt({ lineNumber: s.positionLineNumber, column: s.positionColumn }),
    }));
    return { ranges: ranges.length > 0 ? ranges : [{ anchor: 0, head: 0 }] };
  }

  dispose(): void {
    if (this.selectionTimer !== null) clearTimeout(this.selectionTimer);
    this.selectionTimer = null;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  private scheduleSelection(): void {
    if (this.selectionTimer !== null) clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => {
      this.selectionTimer = null;
      if (this.model.isDisposed()) return;
      this.hooks.onLocalSelection(this.getSelection());
    }, SELECTION_DEBOUNCE_MS);
  }

  private withRemoteFlag(fn: () => void): void {
    this.applyingRemote = true;
    try {
      fn();
    } finally {
      this.applyingRemote = false;
    }
  }
}
