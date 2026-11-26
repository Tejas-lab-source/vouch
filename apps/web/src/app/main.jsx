// @ts-check
import '@vouch/ui-web/fonts.css';
import '@vouch/ui-web/styles.css';
import './app.css';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { startMonitoring } from './monitoring.js';
import { createServices } from './services.js';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(<App services={createServices()} />);
void startMonitoring();
