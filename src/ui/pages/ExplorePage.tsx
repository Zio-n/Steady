import { Link } from 'react-router-dom';
import { AppNavigation } from '../AppShell';

export function ExplorePage() {
  return <div className="app-frame"><AppNavigation />
    <main className="main-content page-stack"><div><p className="eyebrow">EXPLORE</p><h1>Recipes from the community</h1></div><p className="field-hint">Published recipes will appear here after their privacy and source-rights checks are complete.</p><Link className="secondary-button" to="/">Back to Calendar</Link></main>
  </div>;
}
