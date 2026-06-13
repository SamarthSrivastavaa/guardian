import { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { Composer } from './components/Composer';
import { RescueTheater } from './components/RescueTheater';

type View = 'dashboard' | 'composer' | 'theater';

const NAV: { id: View; label: string }[] = [
  { id: 'dashboard', label: 'Positions' },
  { id: 'composer', label: 'Policy composer' },
  { id: 'theater', label: 'Rescue Theater' },
];

const initialView = (): View => {
  const h = window.location.hash.replace('#', '');
  return h === 'composer' || h === 'theater' ? h : 'dashboard';
};

export default function App() {
  const [view, setViewState] = useState<View>(initialView);
  const setView = (v: View) => { setViewState(v); window.location.hash = v; };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L4 5.5V11c0 5 3.4 8.4 8 11 4.6-2.6 8-6 8-11V5.5L12 2z" stroke="#ffe500" strokeWidth="2" strokeLinejoin="round" />
              <path d="M9 12l2 2 4-4.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="brand-name">GUARDIAN</div>
            <div className="brand-sub">DeepBook Margin defense</div>
          </div>
        </div>

        <nav className="tabs">
          {NAV.map((n) => (
            <button key={n.id} className={`tab ${view === n.id ? 'active' : ''}`} onClick={() => setView(n.id)}>{n.label}</button>
          ))}
        </nav>

        <div className="header-right">
          <span className="pill">testnet</span>
          <span className="pill accent"><span className="dot" style={{ background: 'var(--ink)' }} />keeper live · non-custodial</span>
        </div>
      </header>

      <main className="main">
        {view === 'dashboard' && <Dashboard />}
        {view === 'composer' && <Composer />}
        {view === 'theater' && <RescueTheater />}
      </main>
    </div>
  );
}
