import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ROOM_ID_REGEX } from '@collab/shared';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { EditorPane } from '../components/EditorPane';
import { NameDialog } from '../components/NameDialog';
import { Toast } from '../components/Toast';
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
  const { snapshot, attachEditor, dismissNotice } = useCollabSession(roomId, name);

  if (snapshot.status === 'error') {
    return (
      <main className="fatal">
        <h1>Can’t join this room</h1>
        <p>{snapshot.error?.message ?? 'Something went wrong.'}</p>
        <Link to="/">Back home</Link>
      </main>
    );
  }

  return (
    <div className="room">
      <header className="toolbar">
        <Link to="/" className="brand">
          Collab Editor
        </Link>
        <span className="room-id">Room {roomId}</span>
        <ConnectionStatus status={snapshot.status} />
      </header>
      <div className="room-body">
        <EditorPane onMount={attachEditor} />
        <UserList me={snapshot.me} users={snapshot.users} />
      </div>
      <Toast message={snapshot.notice} onDismiss={dismissNotice} />
    </div>
  );
}
