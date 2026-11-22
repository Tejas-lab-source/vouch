// @ts-check
import { describe, expect, it } from 'vitest';
import {
  countsTowardLimit,
  judgeConfirm,
  keys,
  objectsOf,
  sniffImageType,
} from '../../../src/modules/media/domain/upload.js';

const UPLOAD_ID = '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e5f';

describe('object keys', () => {
  it('raw and processed objects stay under uploads/; public variants carry a random key, never a user id', () => {
    expect(keys.raw(UPLOAD_ID)).toBe(`uploads/raw/${UPLOAD_ID}`);
    expect(keys.staging(UPLOAD_ID, 'w400')).toBe(`uploads/processed/${UPLOAD_ID}_400.webp`);
    expect(keys.photo('k'.repeat(22), UPLOAD_ID, 'w1080')).toBe(
      `photos/${'k'.repeat(22)}/${UPLOAD_ID}_1080.webp`,
    );
  });

  it('lists every object an upload can own', () => {
    expect(objectsOf({ id: UPLOAD_ID, photoKey: null })).toHaveLength(5);
    expect(objectsOf({ id: UPLOAD_ID, photoKey: 'k'.repeat(22) })).toHaveLength(7);
    expect(keys.review(UPLOAD_ID, 'w1080')).toBe(`review/${UPLOAD_ID}_1080.webp`);
  });
});

describe('magic bytes', () => {
  const bytes = (/** @type {number[]} */ list) => Uint8Array.from(list);
  it('recognises JPEG, PNG and WebP by content, not by name', () => {
    expect(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      'image/jpeg',
    );
    expect(
      sniffImageType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
    ).toBe('image/png');
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });

  it('rejects text, GIF and truncated input', () => {
    expect(sniffImageType(Buffer.from('hello, I am a .jpg'))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniffImageType(bytes([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WAVE'))).toBeNull();
  });
});

describe('photo limit', () => {
  const now = new Date('2026-11-22T10:00:00Z');
  const ttl = 600_000;
  const at = (/** @type {number} */ msAgo) => new Date(now.getTime() - msAgo);

  it('counts live uploads; rejected ones and expired presigns do not count', () => {
    expect(countsTowardLimit({ status: 'pending', createdAt: at(1000) }, now, ttl)).toBe(true);
    expect(countsTowardLimit({ status: 'pending', createdAt: at(ttl) }, now, ttl)).toBe(false);
    for (const status of /** @type {const} */ (['uploaded', 'processing', 'approved'])) {
      expect(countsTowardLimit({ status, createdAt: at(ttl * 10) }, now, ttl)).toBe(true);
    }
    expect(countsTowardLimit({ status: 'rejected', createdAt: at(0) }, now, ttl)).toBe(false);
    expect(countsTowardLimit({ status: 'expired', createdAt: at(0) }, now, ttl)).toBe(false);
  });
});

describe('confirming an upload', () => {
  const upload = /** @type {const} */ ({
    status: 'pending',
    contentType: 'image/jpeg',
    maxBytes: 1234,
  });

  it('confirms only an object of exactly the signed size and type', () => {
    expect(judgeConfirm(upload, { contentLength: 1234, contentType: 'image/jpeg' })).toBe(
      'confirm',
    );
    expect(judgeConfirm(upload, null)).toBe('not_uploaded');
    expect(judgeConfirm(upload, { contentLength: 1233, contentType: 'image/jpeg' })).toBe(
      'not_uploaded',
    );
    expect(judgeConfirm(upload, { contentLength: 1234, contentType: 'image/png' })).toBe(
      'not_uploaded',
    );
  });

  it('is idempotent: a confirmed upload reports its current state', () => {
    expect(judgeConfirm({ ...upload, status: 'uploaded' }, null)).toEqual({
      already: 'processing',
    });
    expect(judgeConfirm({ ...upload, status: 'approved' }, null)).toEqual({ already: 'approved' });
    expect(judgeConfirm({ ...upload, status: 'rejected' }, null)).toEqual({ already: 'rejected' });
  });
});
