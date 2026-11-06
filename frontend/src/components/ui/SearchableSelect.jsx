import { useEffect, useId, useMemo, useRef, useState } from 'react';
import './SearchableSelect.css';

/**
 * Select that also supports typing to filter options.
 * options: [{ value, label }]
 */
function SearchableSelect({
  options = [],
  value,
  onChange,
  placeholder = 'Search...',
  ariaLabel,
}) {
  const listId = useId();
  const rootRef = useRef(null);
  const selected = useMemo(
    () => options.find((option) => option.value === value) || null,
    [options, value],
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selected?.label || '');
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery(selected?.label || '');
    }
  }, [selected, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 80);
    return options
      .filter(
        (option) =>
          option.label.toLowerCase().includes(q) ||
          String(option.value).toLowerCase().includes(q),
      )
      .slice(0, 80);
  }, [options, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery(selected?.label || '');
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, selected]);

  function choose(option) {
    onChange?.(option.value);
    setQuery(option.label);
    setOpen(false);
  }

  function onKeyDown(event) {
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) =>
        filtered.length ? (current + 1) % filtered.length : 0,
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) =>
        filtered.length
          ? (current - 1 + filtered.length) % filtered.length
          : 0,
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[highlight] || filtered[0];
      if (option) choose(option);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      setQuery(selected?.label || '');
    }
  }

  return (
    <div className={`search-select${open ? ' is-open' : ''}`} ref={rootRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul className="search-select__list" id={listId} role="listbox">
          {filtered.length === 0 ? (
            <li className="search-select__empty">No matches</li>
          ) : (
            filtered.map((option, index) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={`search-select__option${
                    index === highlight ? ' is-active' : ''
                  }${option.value === value ? ' is-selected' : ''}`}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(option)}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export default SearchableSelect;
