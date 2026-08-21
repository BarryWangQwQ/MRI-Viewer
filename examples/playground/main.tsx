import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import './playground.css'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(<App />)
