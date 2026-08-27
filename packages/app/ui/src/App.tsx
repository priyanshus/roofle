import { NavLink, Route, Routes } from 'react-router-dom';
import { useLiveConnection } from './ws/useLiveConnection';
import LiveView from './views/LiveView';
import LibraryView from './views/LibraryView';
import SessionView from './views/SessionView';

export default function App() {
  const { state, clearAll } = useLiveConnection();

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-logo">🎙️</div>
          <div>
            <h1>Roofle</h1>
            <div className="tagline">Live Intelligence</div>
          </div>
        </div>

        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Live
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Library
          </NavLink>
        </nav>

        <div className="spacer" />

        <div className="status">
          <span className={`dot ${state.status}`} />
          <span>{state.statusLabel}</span>
          <span className="latency">
            Latency <span className="value">{state.latencyMs !== null ? `${Math.round(state.latencyMs)} ms` : '—'}</span>
          </span>
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<LiveView live={state} onClear={clearAll} />} />
          <Route path="/library" element={<LibraryView />} />
          <Route path="/sessions/:sessionId" element={<SessionView />} />
        </Routes>
      </main>
    </div>
  );
}
