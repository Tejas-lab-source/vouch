// @ts-check
import { createServer } from 'node:http';

/**
 * A local stand-in for the Rekognition JSON API (`X-Amz-Target: RekognitionService.<Op>`).
 * `respond(op, body)` decides the reply; every request is recorded.
 * @param {(op: string, body: any) => { status?: number, json: unknown }} respond
 */
export async function startFakeRekognition(respond) {
  /** @type {{ op: string, body: any }[]} */
  const calls = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const op =
        String(req.headers['x-amz-target'] ?? '')
          .split('.')
          .at(-1) ?? '';
      const body = JSON.parse(raw || '{}');
      calls.push({ op, body });
      const { status = 200, json } = respond(op, body);
      res.writeHead(status, { 'content-type': 'application/x-amz-json-1.1' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    calls,
    stop: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

/** @param {{ name: string, parent?: string, confidence: number }[]} labels */
export const labelsReply = (labels) => ({
  ModerationLabels: labels.map((l) => ({
    Name: l.name,
    ParentName: l.parent ?? '',
    Confidence: l.confidence,
  })),
  ModerationModelVersion: '7.0',
});

/** @param {{ low: number, high: number }[]} ages */
export const facesReply = (ages) => ({
  FaceDetails: ages.map((a) => ({ AgeRange: { Low: a.low, High: a.high }, Confidence: 99 })),
});
