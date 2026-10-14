import { useEffect } from 'react';

const AUTO_DISMISS_MS = 6_000;

interface ToastProps {
  message: string | null;
  onDismiss(): void;
}

export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (message === null) return null;
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
