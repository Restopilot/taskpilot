import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Simple in-memory storage fallback (localStorage for deployed version)
if (!window.storage) {
  window.storage = {
    get: async (key) => {
      const v = localStorage.getItem(key);
      return v ? { value: v } : null;
    },
    set: async (key, value) => {
      localStorage.setItem(key, value);
      return { value };
    },
    delete: async (key) => {
      localStorage.removeItem(key);
      return { deleted: true };
    },
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
