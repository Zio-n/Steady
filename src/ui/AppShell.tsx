import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, Calendar, CalendarDays, CalendarRange, Compass, Menu, Settings2, X } from 'lucide-react';

const navItems = [
  { to: '/', label: 'Calendar', icon: CalendarDays, end: true },
  { to: '/library', label: 'Library', icon: BookOpen },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/settings', label: 'Settings', icon: Settings2 },
];

export function AppNavigation({ onCalendarHeaderHost }: { onCalendarHeaderHost?: (element: HTMLDivElement | null) => void } = {}) {
  const { pathname, search } = useLocation();
  const isCalendar = pathname === '/';
  const params = new URLSearchParams(search);
  const calendarView = params.get('view') === 'week' || params.get('view') === 'month' ? params.get('view') : 'day';
  const date = params.get('date');
  const viewHref = (view: 'day' | 'week' | 'month') => {
    const next = new URLSearchParams();
    if (date) next.set('date', date);
    if (view !== 'day') next.set('view', view);
    return `/${next.size ? `?${next}` : ''}`;
  };
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function closeMenu() {
    setOpen(false);
    menuRef.current?.focus();
  }

  return <>
    <header className="topbar">
      <button ref={menuRef} className="menu-trigger" type="button" aria-label="Open menu" aria-controls="app-sidebar" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={22} strokeWidth={1.8} /></button>
      <NavLink className="wordmark" to="/" aria-label="Steady home">steady<span>.</span></NavLink>
      {!isCalendar && <span className="topbar-context">{pathname === '/library' ? 'Library' : pathname === '/explore' ? 'Explore' : 'Settings'}</span>}
      {isCalendar && <div ref={onCalendarHeaderHost} className="calendar-header-controls" id="calendar-header-controls" />}
    </header>
    <dialog ref={dialogRef} id="app-sidebar" className="sidebar-dialog" aria-label="Main menu" onClose={() => setOpen(false)} onClick={(event) => { if (event.target === dialogRef.current) closeMenu(); }}>
      <div className="sidebar-content">
        <div className="sidebar-heading"><span className="wordmark">steady<span>.</span></span><button className="sidebar-close" type="button" aria-label="Close menu" onClick={closeMenu}><X size={21} /></button></div>
        {isCalendar && <div className="sidebar-calendar-views">
          <p className="sidebar-caption">CALENDAR VIEW</p>
          <nav className="sidebar-nav" aria-label="Calendar views">
            {([['day', 'Day', CalendarDays], ['week', 'Week', CalendarRange], ['month', 'Month', Calendar]] as const).map(([view, label, Icon]) =>
              <Link key={view} to={viewHref(view)} onClick={closeMenu} aria-current={calendarView === view ? 'page' : undefined} className={`sidebar-link${calendarView === view ? ' is-active' : ''}`}><Icon aria-hidden="true" size={20} strokeWidth={1.8} /><span>{label}</span></Link>)}
          </nav>
        </div>}
        <p className="sidebar-caption">YOUR SPACE</p>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navItems.filter(({ to }) => !isCalendar || to !== '/').map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={closeMenu} className={({ isActive }) => `sidebar-link${isActive ? ' is-active' : ''}`}><Icon aria-hidden="true" size={20} strokeWidth={1.8} /><span>{label}</span></NavLink>)}
        </nav>
        <div className="sidebar-note"><CalendarDays size={20} strokeWidth={1.8} /><p>Plan your meals, see what you’ve eaten, and keep the whole week in view.</p></div>
      </div>
    </dialog>
  </>;
}

export function AppShell() {
  const [headerHost, setHeaderHost] = useState<HTMLDivElement | null>(null);
  return <div className="app-frame"><AppNavigation onCalendarHeaderHost={setHeaderHost} /><main className="main-content"><Outlet context={headerHost} /></main></div>;
}
