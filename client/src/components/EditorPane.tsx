import { Editor, type OnMount } from '@monaco-editor/react';

// Module-level so the object identity is stable: the Editor calls updateOptions whenever it changes.
const EDITOR_OPTIONS = { automaticLayout: true, minimap: { enabled: false }, fontSize: 14 };

interface EditorPaneProps {
  /** Must be stable: @monaco-editor/react only reads the first onMount it receives. */
  onMount: OnMount;
}

export function EditorPane({ onMount }: EditorPaneProps) {
  return (
    <div className="editor-pane">
      <Editor theme="vs-dark" options={EDITOR_OPTIONS} onMount={onMount} loading="Loading editor…" />
    </div>
  );
}
