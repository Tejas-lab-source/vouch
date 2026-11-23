// @ts-check
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { API_LOG, startStack } from './stack.js';

/** Starts the stack once for the run; Playwright calls the returned function at the end. */
export default async function globalSetup() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- this run's results folder
  await mkdir(dirname(API_LOG), { recursive: true });
  const stack = await startStack();
  process.env.E2E_BASE_URL = stack.baseURL;
  process.env.E2E_ADMIN_URL = stack.adminURL;
  process.env.E2E_ADMIN = JSON.stringify(stack.admin);
  return stack.stop;
}
