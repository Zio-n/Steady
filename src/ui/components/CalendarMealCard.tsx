import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, EllipsisVertical, Pencil, Trash2, Undo2, X } from 'lucide-react';

export type CalendarMealFood = { key: string; name: string; brand?: string | null; portion: string; calories: string; metrics?: CalendarMealMetric[]; ingredients?: Array<{ key: string; name: string; portion: string; calories: string; metrics: CalendarMealMetric[] }> };
export type CalendarMealMetric = { label: string; value: string };

export function CalendarMealCard({ state, label, calories, foods, metrics, expanded, onToggle, onDetailHost, onDelete, onDuplicate, onMarkEaten, onMarkNotEaten, busy = false, children }: {
  state: string; label?: string | null; calories: string; foods: CalendarMealFood[]; metrics: CalendarMealMetric[];
  expanded: boolean; onToggle: () => void; compact?: boolean;
  onDetailHost?: (host: HTMLDivElement | null) => void;
  onDelete?: () => void; onDuplicate?: () => void; onMarkEaten?: () => void; onMarkNotEaten?: () => void; busy?: boolean;
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const tileRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const names = foods.slice(0, 3).map((food) => food.name).join(', ');
  const title = names + (foods.length > 3 ? ` +${foods.length - 3}` : '');

  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const tile = tileRef.current; const panel = panelRef.current;
      if (!tile || !panel) return;
      const anchor = tile.getBoundingClientRect();
      const width = panel.offsetWidth; const height = panel.offsetHeight;
      const gap = 10; const edge = 12;
      // Meal occurrences span the day column, so the detail surface should
      // follow the clicked row instead of pretending the row is a small event.
      const centeredLeft = anchor.left + anchor.width / 2 - width / 2;
      const left = Math.max(edge, Math.min(centeredLeft, window.innerWidth - width - edge));
      const below = anchor.bottom + gap;
      const above = anchor.top - height - gap;
      const desiredTop = below + height <= window.innerHeight - edge
        ? below
        : above >= edge
          ? above
          : below;
      const top = Math.max(edge, Math.min(desiredTop, window.innerHeight - height - edge));
      panel.style.left = `${left}px`; panel.style.top = `${top}px`;
    };
    place(); closeRef.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    if (panelRef.current) observer.observe(panelRef.current);
    if (tileRef.current) observer.observe(tileRef.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [expanded, editing, menuOpen]);

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || tileRef.current?.contains(target)) return;
      // A portion correction can open its own native dialog above this panel.
      if (target instanceof Element && target.closest('dialog')) return;
      onToggle();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      event.preventDefault(); onToggle(); tileRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [expanded, onToggle]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [menuOpen]);

  const mealState = state.replace(' meal', '');
  const stateClass = mealState === 'Eaten' ? 'is-eaten' : mealState === 'Planned' ? 'is-planned' : 'is-partial';

  return <>
    <button ref={tileRef} type="button" className={`calendar-meal-tile ${stateClass}${expanded ? ' is-open' : ''}`} aria-label={`Open ${title}, ${calories} kcal, ${mealState}`} aria-haspopup="dialog" aria-expanded={expanded} onClick={() => { setEditing(false); setMenuOpen(false); onToggle(); }}>
      <span className="calendar-meal-tile-top"><strong>{title}</strong><span className="calendar-meal-tile-calories"><span>{calories} <small>kcal</small></span><small className={`calendar-meal-tile-state ${stateClass}`}>{label && label !== 'unlabelled' ? `${label} · ` : ''}{mealState}</small></span></span>
      <span className="calendar-meal-tile-bottom">{metrics.slice(0, 3).map((metric) => <span key={metric.label}>{metric.label} <strong>{metric.value}</strong></span>)}</span>
    </button>
    {expanded && createPortal(<div ref={panelRef} role="dialog" aria-label={`Meal: ${title}`} aria-modal="false" className="calendar-meal-floating">
      <div className="calendar-meal-floating-toolbar">
        {children && <button type="button" className={`icon-button${editing ? ' is-active' : ''}`} aria-label={editing ? 'Finish editing meal' : 'Edit meal'} aria-pressed={editing} disabled={busy} onClick={() => { setEditing((current) => !current); setMenuOpen(false); }}><Pencil size={17} /></button>}
        {onDelete && <button type="button" className="icon-button calendar-meal-delete" aria-label="Delete meal" disabled={busy} onClick={onDelete}><Trash2 size={17} /></button>}
        {onDuplicate && <div className="calendar-meal-menu-anchor" ref={menuRef}><button type="button" className="icon-button" aria-label="More meal actions" aria-haspopup="menu" aria-expanded={menuOpen} disabled={busy} onClick={() => setMenuOpen((open) => !open)}><EllipsisVertical size={19} /></button>{menuOpen && <div className="calendar-meal-action-menu" role="menu"><button type="button" role="menuitem" disabled={busy} onClick={() => { setMenuOpen(false); onDuplicate(); }}><Copy size={15} />Duplicate</button></div>}</div>}
        <button ref={closeRef} type="button" className="icon-button" aria-label="Close meal details" onClick={() => { onToggle(); tileRef.current?.focus({ preventScroll: true }); }}><X size={19} /></button>
      </div>
      <div className="calendar-meal-floating-body">
        <div className="calendar-meal-floating-title"><h2>{title}</h2><strong>{calories} <small>kcal</small></strong></div>
        <p className="calendar-meal-floating-state">{[label && label !== 'unlabelled' ? label : '', mealState].filter(Boolean).join(' · ')}</p>
        {children && editing
          ? <div className="calendar-meal-edit-list">{children}</div>
          : <ul className="calendar-meal-food-preview" aria-label="Foods in this meal">{foods.map((food) => <li key={food.key}>
            <details className="calendar-meal-food-accordion"><summary><span className="calendar-meal-food-name"><strong>{food.name}</strong>{food.brand && <small>{food.brand}</small>}</span><span className="calendar-meal-food-portion">{food.portion}</span><span className="calendar-meal-food-calories">{food.calories} <small>kcal</small></span></summary>
            {food.ingredients && food.ingredients.length > 0 ? <ul className="calendar-meal-ingredient-preview">{food.ingredients.map((ingredient) => <li key={ingredient.key}><div><strong>{ingredient.name}</strong><small>{ingredient.portion}</small><span>{ingredient.calories} kcal</span></div>{ingredient.metrics.length > 0 && <dl className="calendar-meal-food-attributes">{ingredient.metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>}</li>)}</ul>
              : food.metrics && food.metrics.length > 0 && <dl className="calendar-meal-food-attributes">{food.metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>}
          </details></li>)}</ul>}
        {onDetailHost && <div ref={onDetailHost} className="calendar-meal-draft-editor" />}
        {metrics.length > 0 && <section className="calendar-meal-nutrition" aria-labelledby="calendar-meal-nutrition-heading"><h3 id="calendar-meal-nutrition-heading">Meal nutrition</h3><dl>{metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl></section>}
      </div>
      {(onMarkEaten || onMarkNotEaten) && <div className="calendar-meal-floating-footer">{onMarkNotEaten && <button type="button" className="secondary-button" disabled={busy} onClick={onMarkNotEaten}><Undo2 size={16} />Mark as not eaten</button>}{onMarkEaten && <button type="button" className="primary-button" disabled={busy} onClick={onMarkEaten}><Check size={16} />Mark as eaten</button>}</div>}
    </div>, document.body)}
  </>;
}
