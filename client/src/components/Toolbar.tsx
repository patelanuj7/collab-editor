import { Link } from 'react-router-dom';
import type { LanguageId } from '@collab/shared';
import type { SessionStatus } from '../session/CollabSession';
import { ConnectionStatus } from './ConnectionStatus';
import { LanguageSelect } from './LanguageSelect';
import { ShareButton } from './ShareButton';

interface ToolbarProps {
  roomId: string;
  language: LanguageId;
  status: SessionStatus;
  onLanguageChange(language: LanguageId): void;
}

export function Toolbar({ roomId, language, status, onLanguageChange }: ToolbarProps) {
  return (
    <header className="toolbar">
      <Link to="/" className="brand">
        Collab Editor
      </Link>
      <span className="room-id" title={roomId}>
        {roomId}
      </span>
      <div className="toolbar__actions">
        <LanguageSelect language={language} disabled={status !== 'ready'} onChange={onLanguageChange} />
        <ShareButton />
        <ConnectionStatus status={status} />
      </div>
    </header>
  );
}
