import { NavLink, Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard.jsx'
import Review from './pages/Review.jsx'
import Cards from './pages/Cards.jsx'
import CardForm from './pages/CardForm.jsx'
import Import from './pages/Import.jsx'
import Settings from './pages/Settings.jsx'
import './App.css'

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/review', label: 'Review' },
  { to: '/cards', label: 'Cards' },
  { to: '/import', label: 'Import' },
  { to: '/settings', label: 'Settings' },
]

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">Vocab SRS</span>
        <nav className="app-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/review" element={<Review />} />
          <Route path="/cards" element={<Cards />} />
          <Route path="/cards/new" element={<CardForm />} />
          <Route path="/cards/:id/edit" element={<CardForm />} />
          <Route path="/import" element={<Import />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
