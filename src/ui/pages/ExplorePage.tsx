import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppNavigation } from '../AppShell';

export function ExplorePage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return <div className={`app-frame${sidebarOpen ? ' has-sidebar' : ''}`}><AppNavigation open={sidebarOpen} onToggle={() => setSidebarOpen((current) => !current)} onClose={() => setSidebarOpen(false)} />
    <button className="sidebar-backdrop" type="button" aria-label="Close menu" tabIndex={sidebarOpen ? 0 : -1} onClick={() => setSidebarOpen(false)} />
    <div className="app-body"><main className="main-content page-stack"><div><p className="eyebrow">EXPLORE</p><h1>Recipes from the community</h1></div><p className="field-hint">Published recipes will appear here after their privacy and source-rights checks are complete.</p><Link className="secondary-button" to="/">Back to Calendar</Link></main></div>
  </div>;
}
