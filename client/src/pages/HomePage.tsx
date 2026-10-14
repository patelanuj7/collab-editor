import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
import { ROOM_ID_LENGTH, ROOM_ID_REGEX } from '@collab/shared';

/** Accepts a bare room id or any URL whose path is /r/<id>. */
function parseRoomInput(input: string): string | null {
  const trimmed = input.trim();
  if (ROOM_ID_REGEX.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed, window.location.origin);
    const id = /^\/r\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    return id !== undefined && ROOM_ID_REGEX.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function HomePage() {
  const navigate = useNavigate();
  const [joinInput, setJoinInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleJoin = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const roomId = parseRoomInput(joinInput);
    if (!roomId) {
      setError('That doesn’t look like a room code or room link.');
      return;
    }
    navigate(`/r/${roomId}`);
  };

  return (
    <main className="home">
      <div className="home__card">
        <h1>Collab Editor</h1>
        <p className="home__tagline">Write code together, in real time. Create a room and share the link.</p>
        <button type="button" className="primary home__create" onClick={() => navigate(`/r/${nanoid(ROOM_ID_LENGTH)}`)}>
          Create room
        </button>
        <div className="home__divider">
          <span>or join an existing room</span>
        </div>
        <form className="join-form" onSubmit={handleJoin}>
          <input
            value={joinInput}
            onChange={(e) => {
              setJoinInput(e.target.value);
              setError(null);
            }}
            placeholder="Room code or link"
            aria-label="Room code or link"
            aria-invalid={error !== null}
          />
          <button type="submit" disabled={joinInput.trim() === ''}>
            Join
          </button>
        </form>
        {error && <p className="form-error">{error}</p>}
      </div>
    </main>
  );
}
