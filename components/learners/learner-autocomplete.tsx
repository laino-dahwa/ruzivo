'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { learnersApi } from '../../services/learners';
import type { Learner } from '../../types/learner';

// Autocomplete over all learners; resolves a typed name back to its learner_id for the API.
export function LearnerAutocomplete({ onSelect, placeholder }: { onSelect: (learner: Learner | null) => void; placeholder?: string }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const directoryQuery = useQuery({ queryKey: ['learners', 'directory'], queryFn: () => learnersApi.list() });
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (directoryQuery.data ?? [])
      .filter((learner) => `${learner.first_name} ${learner.last_name}`.toLowerCase().includes(q) || learner.learner_id.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, directoryQuery.data]);

  const choose = (learner: Learner) => {
    setQuery(`${learner.first_name} ${learner.last_name}`);
    onSelect(learner);
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-opacity ${query ? 'opacity-0' : 'opacity-100'}`} />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (!event.target.value) onSelect(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if (event.key === 'Tab' && open && matches.length > 0) {
              // Not prevented: focus still moves to the next field as normal,
              // this just fills the choice in first instead of leaving it blank.
              choose(matches[0]);
            }
          }}
          placeholder={placeholder ?? 'Search learner by name'}
          className="field"
          style={{ paddingLeft: query ? undefined : '2rem' }}
        />
      </div>
      {open && query && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-52 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {matches.map((learner) => (
            <button
              key={learner.learner_id}
              type="button"
              onMouseDown={() => choose(learner)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-secondary"
            >
              <span>{learner.first_name} {learner.last_name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{learner.learner_id}</span>
            </button>
          ))}
        </div>
      )}
      {open && query && matches.length === 0 && !directoryQuery.isLoading && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">No matching learners</div>
      )}
    </div>
  );
}
