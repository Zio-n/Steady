import { useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { Field } from './Field';

const commonUnits = [
  { value: 'g', label: 'g · grams' },
  { value: 'kg', label: 'kg · kilograms' },
  { value: 'mg', label: 'mg · milligrams' },
  { value: 'ml', label: 'ml · millilitres' },
  { value: 'l', label: 'l · litres' },
  { value: 'serving', label: 'serving' },
  { value: 'piece', label: 'piece' },
  { value: 'slice', label: 'slice' },
  { value: 'cup', label: 'cup' },
  { value: 'tbsp', label: 'tbsp · tablespoon' },
  { value: 'tsp', label: 'tsp · teaspoon' },
  { value: 'pack', label: 'pack' },
];

export function UnitPicker({ id, value, onChange, label = 'Unit' }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = value.trim().toLocaleLowerCase();
  const matches = (showAll ? commonUnits : commonUnits.filter((unit) => unit.value.includes(query) || unit.label.toLocaleLowerCase().includes(query))).slice(0, 12);
  const custom = Boolean(query && !commonUnits.some((unit) => unit.value === query) && matches.length === 0);
  const options = custom ? [{ value: value.trim(), label: `Use “${value.trim()}” as a custom unit` }] : matches;
  const listId = `${id}-options`;
  const currentIndex = Math.max(0, commonUnits.findIndex((unit) => unit.value === query));

  function selectUnit(next: string) {
    onChange(next);
    setOpen(false);
    setShowAll(false);
    setActiveIndex(0);
  }
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => event.key === 'ArrowDown'
        ? Math.min(current + 1, options.length - 1) : Math.max(current - 1, 0));
    }
    if (event.key === 'Enter' && open && options[activeIndex]) {
      event.preventDefault();
      selectUnit(options[activeIndex].value);
    }
  }

  return <Field id={id} label={label}><div className="unit-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <input ref={inputRef} id={id} className="text-field" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
      autoComplete="off" maxLength={24} value={value} onFocus={(event) => { event.currentTarget.select(); setShowAll(true); setActiveIndex(currentIndex); setOpen(true); }}
      onChange={(event) => { onChange(event.target.value); setShowAll(false); setActiveIndex(0); setOpen(true); }} onKeyDown={handleKeyDown} />
    <button className="unit-picker-toggle" type="button" tabIndex={-1} aria-label="Show common units" onMouseDown={(event) => event.preventDefault()} onClick={() => { inputRef.current?.focus(); setShowAll(true); setActiveIndex(currentIndex); setOpen(true); }}><ChevronDown size={16} /></button>
    {open && options.length > 0 && <div className="unit-picker-options" id={listId} role="listbox" aria-label="Common units">{options.map((option, index) => <div id={`${listId}-${index}`} key={option.value} role="option" aria-selected={option.value === value} className={`unit-picker-option${index === activeIndex ? ' is-active' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectUnit(option.value)}>{option.label}</div>)}</div>}
  </div></Field>;
}
