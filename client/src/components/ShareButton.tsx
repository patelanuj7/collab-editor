import { useEffect, useRef, useState } from 'react';

const COPIED_MS = 1_500;

export function ShareButton() {
  const [copied, setCopied] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // Clipboard API unavailable or denied (insecure origin, permissions): show the link to copy by hand.
      setFallbackOpen(true);
      return;
    }
    setFallbackOpen(false);
    setCopied(true);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <span className="share">
      <button type="button" onClick={() => void handleClick()}>
        {copied ? 'Copied!' : 'Share'}
      </button>
      {fallbackOpen && (
        <input
          className="share__fallback"
          readOnly
          autoFocus
          value={window.location.href}
          aria-label="Room link"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => setFallbackOpen(false)}
        />
      )}
    </span>
  );
}
