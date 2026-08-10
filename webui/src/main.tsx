import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import '@fortawesome/fontawesome-free/css/all.min.css'
/* Lato, bundled rather than fetched: the panel is served by the device, which
   often has no route to the internet. 400 and 700 only — Bootstrap's
   fw-semibold (600) resolves up to 700. */
import '@fontsource/lato/400.css'
import '@fontsource/lato/700.css'
import './theme.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(<App />)
