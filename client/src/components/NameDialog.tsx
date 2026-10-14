import { useState, type FormEvent } from 'react';
import { NAME_REGEX } from '@collab/shared';
import { setStoredName } from '../lib/identity';

interface NameDialogProps {
  onSubmit(name: string): void;
}

export function NameDialog({ onSubmit }: NameDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = value.trim();
    if (!NAME_REGEX.test(name)) {
      setError('Use 1–24 letters, numbers, spaces, dots, underscores or hyphens.');
      return;
    }
    setStoredName(name);
    onSubmit(name);
  };

  return (
    <div className="dialog-backdrop">
      <form className="dialog" onSubmit={handleSubmit}>
        <h2>What should others call you?</h2>
        <input
          autoFocus
          maxLength={24}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="Your name"
          aria-label="Your name"
          aria-invalid={error !== null}
        />
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={value.trim() === ''}>
          Join
        </button>
      </form>
    </div>
  );
}
