import React from 'react'
import ReactDOM from 'react-dom/client'
import OcrWebApp from './OcrWebApp'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <OcrWebApp />
  </React.StrictMode>,
)