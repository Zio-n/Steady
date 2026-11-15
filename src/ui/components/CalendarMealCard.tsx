import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleDashed, Copy, EllipsisVertical, Pencil, Trash2, Undo2, X } from 'lucide-react';

export type CalendarMealFood = { key: string; name: string; brand?: string | null; portion: string; calories: string; metrics?: CalendarMealMetric[]; ingredients?: Array<{ key: string; name: string; portion: string; calories: string; metrics: CalendarMealMetric[] }> };
export type CalendarMealMetric = { label: string; value: string; incomplete?: boolean };

function IncompleteMark() {
  return <> <CircleDashed size={12} className="nutrition-incomplete-mark" aria-hidden="true" /><span className="visually-hidden">, incomplete</span></>;
}

export function CalendarMealCard({ state: mealState, title: entryTitle, label, recurring, calories, caloriesIncomplete, foods, metrics, expanded, onToggle, onDelete, onDuplicate, onEdit, onAttachFoods, onMarkEaten, markEatenLabel = 'Mark as eaten', onMarkNotEaten, busy = false, libraryActions }: {
  state: 'Eaten' | 'Planned' | 'Partly eaten'; label?: string | null; recurring?: boolean; calories: string; caloriesIncomplete?: boolean; foods: CalendarMealFood[]; metrics: CalendarMealMetric[];
  title?: string;
  expanded: boolean; onToggle: () => void;
  onEdit?: (tile: HTMLButtonElement) => void; onAttachFoods?: (tile: HTMLButtonElement) => void; markEatenLabel?: string;
  onDelete?: () => void; onDuplicate?: () => void; onMarkEaten?: (tile: HTMLButtonElement) => void; onMarkNotEaten?: () => void; busy?: boolean;
  libraryActions?: { kind: 'Food' | 'Meal'; onUse: () => void; onEdit: () => void; onRemove?: () => void };
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tileRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const duplicateAction = useRef<HTMLButtonElement>(null);
  const names = foods.slice(0, 3).map((food) => food.name).join(', ');
  const title = entryTitle ?? names + (foods.length > 3 ? ` +${foods.length - 3}` : '');

  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const tile = tileRef.current; const panel = panelRef.current;
      if (!tile || !panel) return;
      const anchor = tile.getBoundingClientRect();
      const width = panel.offsetWidth; const height = panel.offsetHeight;
      const edge = 12;
      const centeredLeft = anchor.left + anchor.width / 2 - width / 2;
      const centeredTop = anchor.top + anchor.height / 2 - height / 2;
      const left = Math.max(edge, Math.min(centeredLeft, window.innerWidth - width - edge));
      const top = Math.max(edge, Math.min(centeredTop, window.innerHeight - height - edge));
      panel.style.left = `${left}px`; panel.style.top = `${top}px`;
    };
    place(); closeRef.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    if (panelRef.current) observer.observe(panelRef.current);
    if (tileRef.current) observer.observe(tileRef.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || tileRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('dialog')) return;
      onToggle();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if (menuOpen) {
        event.preventDefault(); setMenuOpen(false); menuTrigger.current?.focus();
        return;
      }
      event.preventDefault(); onToggle(); tileRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [expanded, menuOpen, onToggle]);

  useEffect(() => {
    if (!menuOpen) return;
    duplicateAction.current?.focus({ preventScroll: true });
    const closeOutside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [menuOpen]);

  const stateClass = libraryActions ? 'is-library' : mealState === 'Eaten' ? 'is-eaten' : mealState === 'Planned' ? 'is-planned' : 'is-partial';

  return <>
    <button ref={tileRef} type="button" className={`calendar-meal-tile ${stateClass}${expanded ? ' is-open' : ''}`} aria-label={`Open ${title}, ${calories} kcal${caloriesIncomplete ? ', incomplete' : ''}, ${libraryActions?.kind ?? mealState}${!libraryActions && recurring ? ', repeating' : ''}`} aria-haspopup="dialog" aria-expanded={expanded} onClick={() => { setMenuOpen(false); onToggle(); }}>
      <span className="calendar-meal-tile-top"><strong>{title}</strong><span className="calendar-meal-tile-calories"><span>{calories} <small>kcal</small>{caloriesIncomplete && <IncompleteMark />}</span><small className={`calendar-meal-tile-state ${stateClass}`}>{libraryActions ? libraryActions.kind : `${recurring ? 'Repeating · ' : ''}${mealState}`}</small></span></span>
      <span className="calendar-meal-tile-bottom">{metrics.slice(0, 3).map((metric) => <span key={metric.label}>{metric.label} <strong>{metric.value}</strong>{metric.incomplete && <IncompleteMark />}</span>)}</span>
    </button>
    {expanded && createPortal(<div ref={panelRef} role="dialog" aria-label={`${libraryActions?.kind ?? 'Meal'}: ${title}`} aria-modal="false" className={`calendar-meal-floating${libraryActions ? ' is-library-detail' : ''}`}>
      <div className="calendar-meal-floating-toolbar">
        {libraryActions && <button type="button" className="icon-button" aria-label={`Edit ${libraryActions.kind.toLowerCase()}`} disabled={busy} onClick={libraryActions.onEdit}><Pencil size={17} /></button>}
        {libraryActions?.onRemove && <button type="button" className="icon-button calendar-meal-delete" aria-label={`Remove ${libraryActions.kind.toLowerCase()}`} disabled={busy} onClick={libraryActions.onRemove}><Trash2 size={17} /></button>}
        {!libraryActions && onEdit && <button type="button" className="icon-button" aria-label="Edit meal" disabled={busy} onClick={() => { if (tileRef.current) onEdit(tileRef.current); }}><Pencil size={17} /></button>}
        {!libraryActions && onDelete && <button type="button" className="icon-button calendar-meal-delete" aria-label="Delete meal" disabled={busy} onClick={onDelete}><Trash2 size={17} /></button>}
        {onDuplicate && <div className="calendar-meal-menu-anchor" ref={menuRef}>
          <button ref={menuTrigger} type="button" className="icon-button" aria-label="More meal actions" aria-expanded={menuOpen} disabled={busy} onClick={() => setMenuOpen((open) => !open)}><EllipsisVertical size={19} /></button>
          {menuOpen && <div className="calendar-meal-action-menu">
            <button ref={duplicateAction} type="button" disabled={busy} onClick={() => { setMenuOpen(false); onDuplicate(); }}>
              <Copy size={15} aria-hidden="true" />{mealState === 'Partly eaten' ? 'Copy as planned' : 'Duplicate'}
            </button>
          </div>}
        </div>}
        <button ref={closeRef} type="button" className="icon-button" aria-label="Close meal details" onClick={() => { onToggle(); tileRef.current?.focus({ preventScroll: true }); }}><X size={19} /></button>
      </div>
      <div className="calendar-meal-floating-body">
        <div className="calendar-meal-floating-title"><h2>{title}</h2><strong>{calories} <small>kcal</small>{caloriesIncomplete && <IncompleteMark />}</strong></div>
        <p className="calendar-meal-floating-state">{libraryActions ? [libraryActions.kind, libraryActions.kind === 'Food' && foods[0]?.brand, libraryActions.kind === 'Food' && foods[0]?.portion].filter(Boolean).join(' · ') : [label, recurring && 'Repeating', mealState].filter(Boolean).join(' · ')}</p>
        {!onAttachFoods && libraryActions?.kind !== 'Food' && <ul className="calendar-meal-food-preview" aria-label="Foods in this meal">{foods.map((food) => <li key={food.key}>
            <details className="calendar-meal-food-accordion"><summary><span className="calendar-meal-food-name"><strong>{food.name}</strong>{food.brand && <small>{food.brand}</small>}</span><span className="calendar-meal-food-portion">{food.portion}</span><span className="calendar-meal-food-calories">{food.calories} <small>kcal</small></span></summary>
            {food.ingredients && food.ingredients.length > 0 ? <ul className="calendar-meal-ingredient-preview">{food.ingredients.map((ingredient) => <li key={ingredient.key}><div><strong>{ingredient.name}</strong><small>{ingredient.portion}</small><span>{ingredient.calories} kcal</span></div>{ingredient.metrics.length > 0 && <dl className="calendar-meal-food-attributes">{ingredient.metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>}</li>)}</ul>
              : food.metrics && food.metrics.length > 0 && <dl className="calendar-meal-food-attributes">{food.metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}{metric.incomplete && <IncompleteMark />}</dd></div>)}</dl>}
          </details></li>)}</ul>}
        {metrics.length > 0 && <section className="calendar-meal-nutrition" aria-labelledby="calendar-meal-nutrition-heading"><h3 id="calendar-meal-nutrition-heading">{libraryActions?.kind === 'Food' ? 'Nutrition' : 'Meal nutrition'}</h3><dl>{metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}{metric.incomplete && <IncompleteMark />}</dd></div>)}</dl></section>}
      </div>
      {(onMarkEaten || onMarkNotEaten || onAttachFoods || libraryActions) && <div className="calendar-meal-floating-footer">
        {libraryActions && <button type="button" className="primary-button" disabled={busy} onClick={libraryActions.onUse}><Check size={16} />Use</button>}
        {onAttachFoods && <button type="button" className="secondary-button" disabled={busy} onClick={() => { if (tileRef.current) onAttachFoods(tileRef.current); }}>Add foods</button>}
        {onMarkNotEaten && <button type="button" className="secondary-button" disabled={busy} onClick={onMarkNotEaten}><Undo2 size={16} />Mark as not eaten</button>}
        {onMarkEaten && <button type="button" className="primary-button" disabled={busy} onClick={() => { if (tileRef.current) onMarkEaten(tileRef.current); }}><Check size={16} />{markEatenLabel}</button>}
      </div>}
    </div>, document.body)}
  </>;
}
