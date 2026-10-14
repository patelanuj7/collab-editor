import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type * as monaco from 'monaco-editor';
import type { LanguageId } from '@collab/shared';
import { CollabSession, INITIAL_SNAPSHOT, type SessionSnapshot } from '../session/CollabSession';

interface MountedEditor {
  editor: monaco.editor.IStandaloneCodeEditor;
  monacoNs: typeof monaco;
}

/**
 * A stable external store that forwards to whichever session is current, so
 * useSyncExternalStore keeps one subscription while sessions come and go
 * (StrictMode's double effect, or a name change).
 */
class SessionHolder {
  session: CollabSession | null = null;
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;

  set(session: CollabSession | null): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session = session;
    if (session) this.unsubscribe = session.subscribe(this.notify);
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.session?.getSnapshot() ?? INITIAL_SNAPSHOT;

  private notify = (): void => {
    for (const listener of this.listeners) listener();
  };
}

export function useCollabSession(roomId: string, name: string) {
  const [holder] = useState(() => new SessionHolder());
  // Lets a new session pick up an editor that mounted before it existed.
  const editorRef = useRef<MountedEditor | null>(null);

  useEffect(() => {
    const session = new CollabSession(roomId, name);
    const mounted = editorRef.current;
    if (mounted) session.attachEditor(mounted.editor, mounted.monacoNs);
    holder.set(session);
    return () => {
      session.dispose();
      if (holder.session === session) holder.set(null);
    };
  }, [holder, roomId, name]);

  const snapshot = useSyncExternalStore(holder.subscribe, holder.getSnapshot);

  const attachEditor = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor, monacoNs: typeof monaco) => {
      editorRef.current = { editor, monacoNs };
      holder.session?.attachEditor(editor, monacoNs);
    },
    [holder],
  );

  const setLanguage = useCallback((language: LanguageId) => holder.session?.setLanguage(language), [holder]);
  const dismissNotice = useCallback(() => holder.session?.dismissNotice(), [holder]);

  return { snapshot, attachEditor, setLanguage, dismissNotice };
}
