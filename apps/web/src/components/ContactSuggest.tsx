'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { api } from '@/lib/api';
import { Input } from './ui';

export interface SuggestedContact {
  id: string;
  name: string;
  email: string;
  company: string | null;
  locale: string;
}

/** Text input that suggests saved contacts as you type; choosing one calls onPick. */
export function ContactSuggest({ value, onChange, onPick, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & { value: string; onChange: (v: string) => void; onPick: (c: SuggestedContact) => void }) {
  const [items, setItems] = useState<SuggestedContact[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current || value.trim().length < 2) {
      setItems([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ contacts: SuggestedContact[] }>(`/contacts/suggest?q=${encodeURIComponent(value.trim())}`)
        .then((r) => {
          setItems(r.contacts);
          setActive(0);
          setOpen(r.contacts.length > 0);
        })
        .catch(() => setItems([]));
    }, 200);
    return () => clearTimeout(t);
  }, [value]);

  const pick = (c: SuggestedContact) => {
    typed.current = false;
    setOpen(false);
    onPick(c);
  };

  return (
    <div className="relative">
      <Input
        {...props}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {items.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={`block w-full px-3 py-2 text-left text-sm ${i === active ? 'bg-brand-50' : 'hover:bg-gray-50'}`}
              >
                <span className="block font-medium text-ink">{c.name}</span>
                <span className="block text-xs text-gray-500">
                  {c.email}
                  {c.company ? ` · ${c.company}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
