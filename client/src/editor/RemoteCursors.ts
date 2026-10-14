import type * as monaco from 'monaco-editor';
import { transformSelection, type Selection, type TextOperation } from '@collab/shared';
import type { RemoteUser } from '../session/CollabSession';

type MonacoNamespace = typeof monaco;

const STYLE_ELEMENT_ID = 'remote-cursor-styles';
const LABEL_IDLE_MS = 2_000;
const FALLBACK_COLOR = '#94a3b8';

interface CursorState {
  user: RemoteUser;
  /** Sanitized clientId used in class names. */
  cssId: string;
  selection: Selection | null;
  decorations: monaco.editor.IEditorDecorationsCollection;
  idle: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

// One <style> element is shared by every live instance (StrictMode and editor
// remounts can briefly create two), so its text is rebuilt from all of them.
const liveInstances = new Set<RemoteCursors>();

function refreshStyleElement(): void {
  let el = document.getElementById(STYLE_ELEMENT_ID);
  if (liveInstances.size === 0) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  el.textContent = [...liveInstances].map((i) => i.cssText()).join('\n');
}

function sanitizeId(clientId: string): string {
  return clientId.replace(/[^A-Za-z0-9_-]/g, '');
}

function safeColor(color: string): string {
  // Colors come from the server; never let one break out of the CSS declaration.
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : FALLBACK_COLOR;
}

function cssString(text: string): string {
  // NAME_REGEX already forbids these, but the label is still built defensively.
  return `"${text.replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, ' ')}"`;
}

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.ranges.length === b.ranges.length &&
    a.ranges.every((r, i) => r.anchor === b.ranges[i]?.anchor && r.head === b.ranges[i]?.head)
  );
}

/** Renders other users' carets, selections, and name labels as Monaco decorations. */
export class RemoteCursors {
  private readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly monacoNs: MonacoNamespace;
  private readonly cursors = new Map<string, CursorState>();

  constructor(editor: monaco.editor.IStandaloneCodeEditor, monacoNs: MonacoNamespace) {
    this.editor = editor;
    this.monacoNs = monacoNs;
    liveInstances.add(this);
  }

  /**
   * Syncs with the session's user list (selections in local coordinates). A selection
   * that differs from what we already show counts as movement and wakes the label.
   */
  update(users: readonly RemoteUser[]): void {
    const seen = new Set<string>();
    let stylesChanged = false;
    for (const user of users) {
      seen.add(user.clientId);
      let state = this.cursors.get(user.clientId);
      if (!state) {
        state = {
          user,
          cssId: sanitizeId(user.clientId),
          selection: null,
          decorations: this.editor.createDecorationsCollection(),
          idle: true,
          idleTimer: null,
        };
        this.cursors.set(user.clientId, state);
        stylesChanged = true;
      }
      state.user = user;
      if (sameSelection(state.selection, user.selection)) continue;
      state.selection = user.selection;
      if (user.selection) this.wake(state);
      else this.render(state);
    }
    for (const id of [...this.cursors.keys()]) {
      if (!seen.has(id)) {
        this.removeState(id);
        stylesChanged = true;
      }
    }
    if (stylesChanged) refreshStyleElement();
  }

  /** Moves every stored selection through an op the local document just applied. */
  transformAll(op: TextOperation): void {
    for (const state of this.cursors.values()) {
      if (!state.selection) continue;
      state.selection = transformSelection(state.selection, op);
      this.render(state);
    }
  }

  /** The user did something (e.g. typed) that should show their label even if the caret didn't jump. */
  markActive(clientId: string): void {
    const state = this.cursors.get(clientId);
    if (state?.selection) this.wake(state);
  }

  remove(clientId: string): void {
    if (this.removeState(clientId)) refreshStyleElement();
  }

  dispose(): void {
    for (const id of [...this.cursors.keys()]) this.removeState(id);
    liveInstances.delete(this);
    refreshStyleElement();
  }

  /** CSS for this instance's users; read by the shared style element. */
  cssText(): string {
    return [...this.cursors.values()]
      .map(({ cssId, user }) => {
        const color = safeColor(user.color);
        return [
          `.rc-caret-${cssId} { border-left-color: ${color}; }`,
          `.rc-sel-${cssId} { background-color: ${color}40; }`,
          `.rc-label-${cssId}::after { content: ${cssString(user.name)}; background-color: ${color}; }`,
        ].join('\n');
      })
      .join('\n');
  }

  private removeState(clientId: string): boolean {
    const state = this.cursors.get(clientId);
    if (!state) return false;
    if (state.idleTimer !== null) clearTimeout(state.idleTimer);
    state.decorations.clear();
    this.cursors.delete(clientId);
    return true;
  }

  private wake(state: CursorState): void {
    state.idle = false;
    if (state.idleTimer !== null) clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => {
      state.idleTimer = null;
      state.idle = true;
      this.render(state);
    }, LABEL_IDLE_MS);
    this.render(state);
  }

  private render(state: CursorState): void {
    const model = this.editor.getModel();
    if (!state.selection || !model || model.isDisposed()) {
      state.decorations.clear();
      return;
    }
    const { Range } = this.monacoNs;
    const stickiness = this.monacoNs.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges;
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    state.selection.ranges.forEach((r, i) => {
      if (r.anchor !== r.head) {
        const start = model.getPositionAt(Math.min(r.anchor, r.head));
        const end = model.getPositionAt(Math.max(r.anchor, r.head));
        decorations.push({
          range: new Range(start.lineNumber, start.column, end.lineNumber, end.column),
          options: { className: `rc-sel rc-sel-${state.cssId}`, stickiness },
        });
      }
      const head = model.getPositionAt(r.head);
      // Only the primary cursor carries the name label.
      const label = i === 0 ? ` rc-label rc-label-${state.cssId}${state.idle ? ' rc-idle' : ''}` : '';
      decorations.push({
        range: new Range(head.lineNumber, head.column, head.lineNumber, head.column),
        options: { beforeContentClassName: `rc-caret rc-caret-${state.cssId}${label}`, stickiness },
      });
    });
    state.decorations.set(decorations);
  }
}
