import { useSyncExternalStore } from 'react';

// A conservative tab-local guard: not every editor has a trustworthy clean
// signal, so an edit keeps the update deferred until the tab is reopened.
let editedInThisTab = false;
const listeners = new Set<() => void>();

export function noteTabEdit() {
  if (editedInThisTab) return;
  editedInThisTab = true;
  listeners.forEach((listener) => listener());
}

export function hasTabEdits() {
  return editedInThisTab;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useTabEdits() {
  return useSyncExternalStore(subscribe, hasTabEdits, () => false);
}
