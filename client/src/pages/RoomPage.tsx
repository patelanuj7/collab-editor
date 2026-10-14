import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ROOM_ID_REGEX } from '@collab/shared';
import { EditorPane } from '../components/EditorPane';
import { NameDialog } from '../components/NameDialog';
import { Toast } from '../components/Toast';
import { Toolbar } from '../components/Toolbar';
import { UserList } from '../components/UserList';
import { useCollabSession } from '../hooks/useCollabSession';
import { getStoredName } from '../lib/identity';

export function RoomPage() {
  const { roomId = '' } = useParams();
  const [name, setName] = useState(getStoredName);

  if (!ROOM_ID_REGEX.test(roomId)) return <Navigate to="/" replace />;
  if (!name) return <NameDialog onSubmit={setName} />;
  // Keyed so a different room always gets a fresh session and editor.
  return <RoomView key={roomId} roomId={roomId} name={name} />;
}

function RoomView({ roomId, name }: { roomId: string; name: string }) {
  const { snapshot, attachEditor, setLanguage, dismissNotice } = useCollabSession(roomId, name);

  if (snapshot.status === 'error') {
    return (
      <main className="page-message">
        <h1>Can’t join this room</h1>
        <p>{snapshot.error?.message ?? 'Something went wrong.'}</p>
        <Link to="/" className="button-link">
          Back home
        </Link>
      </main>
    );
  }

  return (
    <div className="room">
      <Toolbar
        roomId={roomId}
        language={snapshot.language}
        status={snapshot.status}
        onLanguageChange={setLanguage}
      />
      <div className="room-body">
        <EditorPane onMount={attachEditor} />
        <UserList me={snapshot.me} users={snapshot.users} />
      </div>
      <Toast message={snapshot.notice} onDismiss={dismissNotice} />
    </div>
  );
}
