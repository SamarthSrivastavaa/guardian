import { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { Composer } from './components/Composer';
import { RescueTheater } from './components/RescueTheater';
import { SavesWall } from './components/SavesWall';
import { Lenders } from './components/Lenders';
import { BuildStatus } from './components/BuildStatus';
import { Landing } from './components/Landing';
import { Docs } from './components/Docs';
import { WalletButton } from './components/WalletButton';

type View = 'landing' | 'dashboard' | 'composer' | 'theater' | 'saves' | 'lenders' | 'status' | 'docs';

const NAV: { id: View; label: string }[] = [
  { id: 'dashboard', label: 'Positions' },
  { id: 'composer', label: 'Policy composer' },
  { id: 'theater', label: 'Rescue Theater' },
  { id: 'saves', label: 'Saves Wall' },
  { id: 'lenders', label: 'For Lenders' },
  { id: 'docs', label: 'Docs' },
];

const ALL_VIEWS = ['landing', 'dashboard', 'composer', 'theater', 'saves', 'lenders', 'status', 'docs'];

const initialView = (): View => {
  const h = window.location.hash.replace('#', '');
  return ALL_VIEWS.includes(h) ? (h as View) : 'landing';
};

export default function App() {
  const [view, setViewState] = useState<View>(initialView);
  const setView = (v: View) => { setViewState(v); window.location.hash = v; };

  return (
    <div className="app">
      <header className="header">
        <button className="brand" style={{ cursor: 'pointer' }} onClick={() => setView('landing')}>
          <div className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L4 5.5V11c0 5 3.4 8.4 8 11 4.6-2.6 8-6 8-11V5.5L12 2z" stroke="#ffe500" strokeWidth="2" strokeLinejoin="round" />
              <path d="M9 12l2 2 4-4.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ textAlign: 'left' }}>
            <div className="brand-name">GUARDIAN</div>
            <div className="brand-sub">DeepBook Margin defense</div>
          </div>
        </button>

        <nav className="tabs">
          {NAV.map((n) => (
            <button key={n.id} className={`tab ${view === n.id ? 'active' : ''}`} onClick={() => setView(n.id)}>{n.label}</button>
          ))}
        </nav>

        <div className="header-right">
          <span className="pill">testnet</span>
          <WalletButton />
        </div>
      </header>

      <main className="main">
        {view === 'landing' && <Landing go={(v) => setView(v as View)} />}
        {view === 'dashboard' && <Dashboard />}
        {view === 'composer' && <Composer />}
        {view === 'theater' && <RescueTheater />}
        {view === 'saves' && <SavesWall />}
        {view === 'lenders' && <Lenders />}
        {view === 'status' && <BuildStatus />}
        {view === 'docs' && <Docs />}
      </main>
    </div>
  );
}
