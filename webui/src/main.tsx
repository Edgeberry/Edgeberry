import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './theme.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(<App />)
