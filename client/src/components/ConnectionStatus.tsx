import type { SessionStatus } from '../session/CollabSession';

const LABELS: Record<SessionStatus, string> = {
  connecting: 'Connecting…',
  joining: 'Joining…',
  ready: 'Connected',
  reconnecting: 'Reconnecting…',
  error: 'Disconnected',
};

export function ConnectionStatus({ status }: { status: SessionStatus }) {
  return (
    <span className={`connection-status connection-status--${status}`} role="status">
      <span className="connection-status__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
