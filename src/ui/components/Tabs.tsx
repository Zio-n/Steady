import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';

type Tab = { label: string; content: ReactNode };

export function Tabs({ tabs, label }: { tabs: Tab[]; label: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const id = useId();

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const edgeIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (!offset && edgeIndex === null) return;
    event.preventDefault();
    const nextIndex = edgeIndex ?? (activeIndex + offset + tabs.length) % tabs.length;
    setActiveIndex(nextIndex);
    document.getElementById(`${id}-tab-${nextIndex}`)?.focus();
  }

  return (
    <div className="tabs">
      <div className="tab-list" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => <button key={tab.label} className="tab-button" type="button" role="tab" id={`${id}-tab-${index}`} aria-controls={`${id}-panel`} aria-selected={index === activeIndex} tabIndex={index === activeIndex ? 0 : -1} onClick={() => setActiveIndex(index)} onKeyDown={onKeyDown}>{tab.label}</button>)}
      </div>
      <section id={`${id}-panel`} className="tab-panel" role="tabpanel" aria-labelledby={`${id}-tab-${activeIndex}`} tabIndex={0}>{tabs[activeIndex]?.content}</section>
    </div>
  );
}
