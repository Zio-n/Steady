import { useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, Calendar, CalendarDays, CalendarRange, Compass, Menu, Settings2 } from 'lucide-react';

const navItems = [
  { to: '/', label: 'Calendar', icon: CalendarDays, end: true },
  { to: '/library', label: 'Library', icon: BookOpen },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/settings', label: 'Settings', icon: Settings2 },
];

export function AppNavigation({ open, onToggle, onClose, onCalendarHeaderHost }: {
  open: boolean; onToggle: () => void; onClose: () => void; onCalendarHeaderHost?: (element: HTMLDivElement | null) => void;
}) {
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
  const menuRef = useRef<HTMLButtonElement>(null);

  return <>
    <header className="topbar">
      <button ref={menuRef} className="menu-trigger" type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-controls="app-sidebar" aria-expanded={open} onClick={onToggle}><Menu size={22} strokeWidth={1.8} /></button>
      <NavLink className="wordmark" to="/" aria-label="Steady home">steady<span>.</span></NavLink>
      {!isCalendar && <span className="topbar-context">{pathname === '/library' ? 'Library' : pathname === '/explore' ? 'Explore' : 'Settings'}</span>}
      {isCalendar && <div ref={onCalendarHeaderHost} className="calendar-header-controls" id="calendar-header-controls" />}
    </header>
    <aside id="app-sidebar" className={`sidebar-dialog${open ? ' is-open' : ''}`} aria-label="Main menu" aria-hidden={!open} inert={!open}>
      <div className="sidebar-content">
        {isCalendar && <div className="sidebar-calendar-views">
          <p className="sidebar-caption">CALENDAR VIEW</p>
          <nav className="sidebar-nav" aria-label="Calendar views">
            {([['day', 'Day', CalendarDays], ['week', 'Week', CalendarRange], ['month', 'Month', Calendar]] as const).map(([view, label, Icon]) =>
              <Link key={view} to={viewHref(view)} onClick={() => { if (window.matchMedia('(max-width: 760px)').matches) onClose(); }} aria-current={calendarView === view ? 'page' : undefined} className={`sidebar-link${calendarView === view ? ' is-active' : ''}`}><Icon aria-hidden="true" size={20} strokeWidth={1.8} /><span>{label}</span></Link>)}
          </nav>
        </div>}
        <p className="sidebar-caption">YOUR SPACE</p>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navItems.filter(({ to }) => !isCalendar || to !== '/').map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => { if (window.matchMedia('(max-width: 760px)').matches) onClose(); }} className={({ isActive }) => `sidebar-link${isActive ? ' is-active' : ''}`}><Icon aria-hidden="true" size={20} strokeWidth={1.8} /><span>{label}</span></NavLink>)}
        </nav>
      </div>
    </aside>
  </>;
}

export function AppShell() {
  const [headerHost, setHeaderHost] = useState<HTMLDivElement | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return <div className={`app-frame${sidebarOpen ? ' has-sidebar' : ''}`}>
    <AppNavigation open={sidebarOpen} onToggle={() => setSidebarOpen((current) => !current)} onClose={() => setSidebarOpen(false)} onCalendarHeaderHost={setHeaderHost} />
    <button className="sidebar-backdrop" type="button" aria-label="Close menu" tabIndex={sidebarOpen ? 0 : -1} onClick={() => setSidebarOpen(false)} />
    <div className="app-body"><main className="main-content"><Outlet context={headerHost} /></main></div>
  </div>;
}
