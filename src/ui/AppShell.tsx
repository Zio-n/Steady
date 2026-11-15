import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, CalendarDays, Menu, Settings2, X } from 'lucide-react';

const sidebarBreakpoint = '(max-width: 760px)';
const navItems = [
  { to: '/', label: 'Calendar', icon: CalendarDays },
  { to: '/library', label: 'Library', icon: BookOpen },
  { to: '/settings', label: 'Settings', icon: Settings2 },
];

function subscribeToSidebarBreakpoint(onChange: () => void) {
  const media = window.matchMedia(sidebarBreakpoint);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function isCompactScreen() {
  return window.matchMedia(sidebarBreakpoint).matches;
}

function calendarDestination(search: string) {
  const params = new URLSearchParams(search);
  const next = new URLSearchParams();
  const date = params.get('date');
  const view = params.get('view');
  if (date) next.set('date', date);
  if (view === 'week' || view === 'month') next.set('view', view);
  return next.size ? `/?${next}` : '/';
}

function SidebarLinks({ pathname, calendarHref, onNavigate }: {
  pathname: string;
  calendarHref: string;
  onNavigate?: () => void;
}) {
  return <nav className="sidebar-nav" aria-label="Main navigation">
    {navItems.map(({ to, label, icon: Icon }) => {
      const active = pathname === to || (to === '/library' && pathname === '/build');
      return <Link
        key={to}
        to={to === '/' ? calendarHref : to}
        aria-current={active ? 'page' : undefined}
        className={`sidebar-link${active ? ' is-active' : ''}`}
        onClick={onNavigate}
      >
        <Icon aria-hidden="true" size={20} strokeWidth={1.8} /><span>{label}</span>
      </Link>;
    })}
  </nav>;
}

export function AppShell() {
  const location = useLocation();
  const { pathname, search } = location;
  const isCalendar = pathname === '/';
  const compact = useSyncExternalStore(subscribeToSidebarBreakpoint, isCompactScreen, () => false);
  const [headerHost, setHeaderHost] = useState<HTMLDivElement | null>(null);
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [drawerLocationKey, setDrawerLocationKey] = useState<string | null>(null);
  const [lastCalendarHref, setLastCalendarHref] = useState('/');
  const menuRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const calendarHref = isCalendar ? calendarDestination(search) : lastCalendarHref;
  const drawerOpen = compact && drawerLocationKey === location.key;
  const open = compact ? drawerOpen : desktopOpen;

  // Keep the last Calendar date and view for sidebar navigation.
  if (isCalendar && lastCalendarHref !== calendarHref) setLastCalendarHref(calendarHref);
  if (drawerLocationKey !== null && (!compact || drawerLocationKey !== location.key)) setDrawerLocationKey(null);

  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    if (!drawerOpen || !drawer) return;
    const trigger = menuRef.current;
    drawer.showModal();
    return () => {
      drawer.close();
      trigger?.focus({ preventScroll: true });
    };
  }, [drawerOpen]);

  function closeDrawer() {
    setDrawerLocationKey(null);
  }

  function toggleSidebar() {
    if (compact) setDrawerLocationKey(drawerOpen ? null : location.key);
    else setDesktopOpen((current) => !current);
  }

  return <div className={`app-frame${!compact && desktopOpen ? ' has-sidebar' : ''}`}>
    <header className="topbar">
      <button ref={menuRef} className="menu-trigger" type="button"
        aria-label={open ? 'Close menu' : 'Open menu'} aria-controls="app-sidebar" aria-expanded={open}
        aria-haspopup={compact ? 'dialog' : undefined} onClick={toggleSidebar}>
        <Menu size={22} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <Link className="wordmark" to="/" aria-label="Steady home">steady<span>.</span></Link>
      {!isCalendar && <span className="topbar-context">{pathname === '/library' || pathname === '/build' ? 'Library' : 'Settings'}</span>}
      {isCalendar && <div ref={setHeaderHost} className="calendar-header-controls" id="calendar-header-controls" />}
    </header>
    {compact ? <dialog ref={drawerRef} id="app-sidebar" className="sidebar-drawer" aria-label="Main menu"
      onCancel={(event) => { event.preventDefault(); closeDrawer(); }}
      onClick={(event) => {
        if (event.target === event.currentTarget && event.clientX >= event.currentTarget.getBoundingClientRect().right) closeDrawer();
      }}>
      <div className="sidebar-content">
        <div className="sidebar-drawer-toolbar">
          <button className="menu-trigger" type="button" aria-label="Close menu" onClick={closeDrawer}>
            <X size={22} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <SidebarLinks pathname={pathname} calendarHref={calendarHref} onNavigate={closeDrawer} />
      </div>
    </dialog> : <aside id="app-sidebar" className="sidebar-docked" aria-hidden={!desktopOpen} inert={!desktopOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        menuRef.current?.focus();
        setDesktopOpen(false);
      }}>
      <div className="sidebar-content">
        <SidebarLinks pathname={pathname} calendarHref={calendarHref} />
      </div>
    </aside>}
    <div className="app-body"><main className="main-content"><Outlet context={headerHost} /></main></div>
  </div>;
}
