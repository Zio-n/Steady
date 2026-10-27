import { NavLink, Outlet } from 'react-router-dom';
import { BookOpen, CalendarDays, CircleUserRound, Leaf } from 'lucide-react';

const navItems = [
  { to: '/', label: 'Today', icon: Leaf, end: true },
  { to: '/library', label: 'Library', icon: BookOpen },
  { to: '/routine', label: 'Routine', icon: CalendarDays },
  { to: '/profile', label: 'Profile', icon: CircleUserRound },
];

export function AppShell() {
  return (
    <div className="app-frame">
      <header className="topbar">
        <NavLink className="wordmark" to="/" aria-label="Steady home">steady<span>.</span></NavLink>
        <nav aria-label="Main navigation" className="desktop-nav">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
              <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
        </nav>
        <NavLink className="avatar-link" to="/profile" aria-label="Open profile"><CircleUserRound size={21} strokeWidth={1.7} /></NavLink>
      </header>
      <main className="main-content"><Outlet /></main>
      <nav aria-label="Main navigation" className="mobile-nav">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `mobile-nav-link${isActive ? ' is-active' : ''}`}>
            <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
