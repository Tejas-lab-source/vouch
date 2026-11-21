// @ts-check
import { describe, expect, it } from 'vitest';
import { buildSchemaSnapshot, diffSnapshots } from '../tooling/index.js';

/** @returns {any} */
const snapshot = () => structuredClone(buildSchemaSnapshot());

/**
 * Applies a change to a fresh snapshot and returns the breaking changes it causes.
 * @param {(next: any) => void} change
 */
function breakingAfter(change) {
  const before = snapshot();
  const after = snapshot();
  change(after);
  return diffSnapshots(before, after);
}

describe('contract diff', () => {
  it('reports nothing for identical snapshots', () => {
    expect(diffSnapshots(snapshot(), snapshot())).toEqual([]);
  });

  describe('additive changes pass', () => {
    it.each([
      [
        'a new optional request field',
        (/** @type {any} */ s) => {
          s.http.swipe.request.body.properties.source = { type: 'string' };
        },
      ],
      [
        'a new response field',
        (/** @type {any} */ s) => {
          s.http.swipe.response.properties.superLike = { type: 'boolean' };
          s.http.swipe.response.required.push('superLike');
        },
      ],
      [
        'a new endpoint',
        (/** @type {any} */ s) => {
          s.http.listLikesIn = structuredClone(s.http.getDeck);
        },
      ],
      [
        'a new event version beside the old one',
        (/** @type {any} */ s) => {
          s.events['match.created.v2'] = structuredClone(s.events['match.created.v1']);
        },
      ],
      [
        'a new enum value in a response',
        (/** @type {any} */ s) => {
          s.socket.serverToClient['conversation.closed'].payload.properties.reason.enum.push(
            'expired',
          );
        },
      ],
      [
        'a relaxed request limit',
        (/** @type {any} */ s) => {
          s.http.reportUser.request.body.properties.note.maxLength = 1000;
        },
      ],
      [
        'a new error code',
        (/** @type {any} */ s) => {
          s.errors.TOO_MANY_PHOTOS = 409;
        },
      ],
    ])('%s', (_label, change) => {
      expect(breakingAfter(change)).toEqual([]);
    });
  });

  describe('breaking changes fail', () => {
    it.each([
      [
        'a removed response field',
        'http.swipe.response.matchId',
        (/** @type {any} */ s) => {
          delete s.http.swipe.response.properties.matchId;
        },
      ],
      [
        'a narrowed type',
        'http.swipe.response.matched',
        (/** @type {any} */ s) => {
          s.http.swipe.response.properties.matched.type = 'string';
        },
      ],
      [
        'a renamed event',
        'events.match.created.v1',
        (/** @type {any} */ s) => {
          s.events['match.made.v1'] = s.events['match.created.v1'];
          delete s.events['match.created.v1'];
        },
      ],
      [
        'a new required request field',
        'http.blockUser.request.body.reason',
        (/** @type {any} */ s) => {
          s.http.blockUser.request.body.properties.reason = { type: 'string' };
          s.http.blockUser.request.body.required.push('reason');
        },
      ],
      [
        'a removed enum value',
        'http.swipe.request.body.direction',
        (/** @type {any} */ s) => {
          s.http.swipe.request.body.properties.direction.enum = ['like'];
        },
      ],
      [
        'a tightened request limit',
        'http.reportUser.request.body.note',
        (/** @type {any} */ s) => {
          s.http.reportUser.request.body.properties.note.maxLength = 100;
        },
      ],
      [
        'a response field made optional',
        'http.swipe.response.matchId',
        (/** @type {any} */ s) => {
          s.http.swipe.response.required = ['matched'];
        },
      ],
      [
        'a removed endpoint',
        'http.getDeck',
        (/** @type {any} */ s) => {
          delete s.http.getDeck;
        },
      ],
      [
        'a changed path',
        'http.getDeck.path',
        (/** @type {any} */ s) => {
          s.http.getDeck.path = '/v1/cards';
        },
      ],
      [
        'tightened auth',
        'http.getConfig.auth',
        (/** @type {any} */ s) => {
          s.http.getConfig.auth = 'user';
        },
      ],
      [
        'a removed socket event',
        'socket.clientToServer.sync',
        (/** @type {any} */ s) => {
          delete s.socket.clientToServer.sync;
        },
      ],
      [
        'a removed error code',
        'errors.BLOCKED',
        (/** @type {any} */ s) => {
          delete s.errors.BLOCKED;
        },
      ],
      [
        'a removed union option in an ack',
        'socket.clientToServer.message.send.ack',
        (/** @type {any} */ s) => {
          s.socket.clientToServer['message.send'].ack.oneOf.pop();
        },
      ],
      [
        'a removed job payload field',
        'jobs.media.processImage.payload.userId',
        (/** @type {any} */ s) => {
          delete s.jobs['media.processImage'].payload.properties.userId;
        },
      ],
    ])('%s', (_label, expectedPath, change) => {
      const breaking = breakingAfter(change);
      expect(breaking.length).toBeGreaterThan(0);
      expect(breaking.map((b) => b.path).join('\n')).toContain(expectedPath);
    });
  });
});
