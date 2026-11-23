// @ts-check
import Constants from 'expo-constants';

/** expo-constants' default export (typed as the module namespace under nodenext). */
const expo =
  /** @type {{ expoConfig?: { version?: string, extra?: Record<string, unknown> } | null }} */ (
    /** @type {any} */ (Constants).default ?? Constants
  );

/** The app version (app.json) and the API URL (`extra.apiUrl`; set per build in Phase 15). */
export const APP_VERSION = expo.expoConfig?.version ?? '1.0.0';
export const API_URL = /** @type {string} */ (
  expo.expoConfig?.extra?.apiUrl ?? 'http://localhost:3000'
);

/** The grievance officer's address (DPDP); a placeholder until the owner provides it (Phase 15). */
export const GRIEVANCE_EMAIL =
  /** @type {string | undefined} */ (expo.expoConfig?.extra?.grievanceEmail) ??
  'grievance@vouch.example';
