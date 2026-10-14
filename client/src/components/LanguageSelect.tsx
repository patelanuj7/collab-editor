import { LANGUAGES, isLanguageId, type LanguageId } from '@collab/shared';

interface LanguageSelectProps {
  language: LanguageId;
  disabled: boolean;
  onChange(language: LanguageId): void;
}

export function LanguageSelect({ language, disabled, onChange }: LanguageSelectProps) {
  return (
    <label className="language-select">
      <span className="visually-hidden">Language</span>
      <select
        value={language}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          if (isLanguageId(next)) onChange(next);
        }}
      >
        {LANGUAGES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
