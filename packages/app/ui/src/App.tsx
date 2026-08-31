import { NavLink, Route, Routes } from 'react-router-dom';
import { LibraryIcon, LogoMark, SparkIcon, TranscriptIcon } from './components/Icons';
import LibraryView from './views/LibraryView';
import LiveView from './views/LiveView';
import MeetingView from './views/MeetingView';
import SessionView from './views/SessionView';
import { useLiveConnection } from './ws/useLiveConnection';

export default function App() {
  const { state, clearAll } = useLiveConnection();

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-logo">
            <LogoMark />
          </div>
          <div>
            <h1>Roofle</h1>
            <div className="tagline">Live Intelligence</div>
          </div>
        </div>

        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <TranscriptIcon size={15} /> Live
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <LibraryIcon size={15} /> Library
          </NavLink>
          <NavLink to="/meetings" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            <SparkIcon size={15} /> Meeting CoPilot
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
          <Route path="/meetings" element={<MeetingView />} />
        </Routes>
      </main>
    </div>
  );
}
