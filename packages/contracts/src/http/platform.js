// @ts-check
import { ConfigResponse } from '../config/index.js';
import { defineEndpoint } from './endpoint.js';

export const getConfig = defineEndpoint({
  id: 'getConfig',
  module: 'platform',
  method: 'GET',
  path: '/v1/config',
  auth: 'optional',
  summary: 'Evaluated flags, minimum app version, limits and campus info.',
  description: 'Clients refetch it on start-up and when the socket sends `config.changed`.',
  response: { status: 200, schema: ConfigResponse },
});

export const platformEndpoints = [getConfig];
