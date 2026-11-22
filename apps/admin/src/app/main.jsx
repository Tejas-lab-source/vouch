// @ts-check
import '@vouch/ui-web/styles.css';
import './admin.css';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(<App />);
