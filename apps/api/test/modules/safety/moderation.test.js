// @ts-check
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { imageModerationStep } from '../../../src/modules/safety/application/content-checks.js';
import { createRekognitionModeration } from '../../../src/modules/safety/adapters/moderation/rekognition.js';
import { canBlock } from '../../../src/modules/safety/domain/block.js';
import { judgeModeration } from '../../../src/modules/safety/domain/moderation.js';
import { facesReply, labelsReply, startFakeRekognition } from './fake-rekognition.js';

const T = { rejectConfidence: 80, reviewConfidence: 50, minorAge: 18 };
const label = (
  /** @type {string} */ name,
  /** @type {number} */ confidence,
  /** @type {string | null} */ parent = null,
) => ({
  name,
  parent,
  confidence,
});

describe('moderation rules', () => {
  it('rejects explicit nudity, graphic violence and hate symbols at 80% or more', () => {
    for (const name of ['Explicit Nudity', 'Explicit', 'Graphic Violence', 'Hate Symbols']) {
      expect(judgeModeration({ labels: [label(name, 80)], faces: [] }, T).verdict).toBe('reject');
    }
    // A child label matches through its parent.
    expect(
      judgeModeration({ labels: [label('Exposed Genitals', 95, 'Explicit Nudity')], faces: [] }, T)
        .verdict,
    ).toBe('reject');
  });

  it('sends 50–80% to review, and allows weaker findings', () => {
    expect(judgeModeration({ labels: [label('Explicit Nudity', 79.9)], faces: [] }, T)).toEqual({
      verdict: 'review',
      reasons: ['Explicit Nudity 80%'],
    });
    expect(judgeModeration({ labels: [label('Hate Symbols', 50)], faces: [] }, T).verdict).toBe(
      'review',
    );
    expect(judgeModeration({ labels: [label('Hate Symbols', 49)], faces: [] }, T).verdict).toBe(
      'approve',
    );
  });

  it('allows suggestive content (swimwear, underwear) at any confidence', () => {
    const labels = [
      label('Suggestive', 99),
      label('Swimwear or Underwear', 99),
      label('Female Swimwear Or Underwear', 98, 'Suggestive'),
    ];
    expect(judgeModeration({ labels, faces: [] }, T)).toEqual({ verdict: 'approve', reasons: [] });
  });

  it('a face whose estimated AgeRange.High is below 18 goes to review, never rejection', () => {
    expect(judgeModeration({ labels: [], faces: [{ ageHigh: 17 }] }, T)).toEqual({
      verdict: 'review',
      reasons: ['face estimated under 18 (1)'],
    });
    expect(judgeModeration({ labels: [], faces: [{ ageHigh: 18 }] }, T).verdict).toBe('approve');
    expect(judgeModeration({ labels: [], faces: [{ ageHigh: null }] }, T).verdict).toBe('approve');
    // The age is configurable.
    expect(
      judgeModeration({ labels: [], faces: [{ ageHigh: 19 }] }, { ...T, minorAge: 21 }).verdict,
    ).toBe('review');
    // An explicit label still rejects even with a young face.
    expect(
      judgeModeration({ labels: [label('Explicit', 90)], faces: [{ ageHigh: 15 }] }, T).verdict,
    ).toBe('reject');
  });

  it('nobody can block themselves', () => {
    expect(canBlock('a', 'b')).toBe(true);
    expect(canBlock('a', 'a')).toBe(false);
  });
});

describe('the image-moderation step', () => {
  it('needs the photo bytes, and reports the provider', async () => {
    const step = imageModerationStep({
      moderation: { name: 'fake', inspect: async () => ({ labels: [], faces: [] }) },
      thresholds: T,
    });
    await expect(step.run({ kind: 'photo' })).rejects.toThrow('photo bytes');
    expect(await step.run({ kind: 'photo', image: new Uint8Array([1]) })).toEqual({
      verdict: 'approve',
      reasons: [],
      provider: 'fake',
    });
  });
});

describe('Rekognition adapter (against a local fake endpoint)', () => {
  /** @type {Awaited<ReturnType<typeof startFakeRekognition>>} */
  let fake;
  /** @type {(op: string) => { status?: number, json: unknown }} */
  let reply = () => ({ json: {} });
  /** @type {Buffer} */
  let webp;

  beforeAll(async () => {
    fake = await startFakeRekognition((op) => reply(op));
    webp = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888' } })
      .webp()
      .toBuffer();
  });
  afterAll(() => fake.stop());

  /** @param {Partial<Parameters<typeof createRekognitionModeration>[0]>} [options] */
  const adapter = (options = {}) =>
    createRekognitionModeration({
      region: 'ap-south-1',
      accessKeyId: 'AKIDTEST',
      secretAccessKey: 'test-secret',
      endpoint: fake.endpoint,
      minConfidence: 50,
      faceAgeCheck: true,
      ...options,
    });

  it('sends the image as JPEG to DetectModerationLabels and DetectFaces, and maps the findings', async () => {
    reply = (op) =>
      op === 'DetectModerationLabels'
        ? {
            json: labelsReply([
              { name: 'Exposed Genitals', parent: 'Explicit Nudity', confidence: 97 },
            ]),
          }
        : { json: facesReply([{ low: 13, high: 17 }]) };
    fake.calls.length = 0;
    const findings = await adapter().inspect(webp);
    expect(findings).toEqual({
      labels: [{ name: 'Exposed Genitals', parent: 'Explicit Nudity', confidence: 97 }],
      faces: [{ ageHigh: 17 }],
    });
    const ops = fake.calls.map((c) => c.op).sort();
    expect(ops).toEqual(['DetectFaces', 'DetectModerationLabels']);
    const moderation = fake.calls.find((c) => c.op === 'DetectModerationLabels');
    expect(moderation?.body.MinConfidence).toBe(50);
    const bytes = Buffer.from(moderation?.body.Image.Bytes, 'base64');
    expect((await sharp(bytes).metadata()).format).toBe('jpeg');
    expect(fake.calls.find((c) => c.op === 'DetectFaces')?.body.Attributes).toEqual(['AGE_RANGE']);
  });

  it('skips DetectFaces when the age check is off', async () => {
    reply = () => ({ json: labelsReply([]) });
    fake.calls.length = 0;
    expect(await adapter({ faceAgeCheck: false }).inspect(webp)).toEqual({ labels: [], faces: [] });
    expect(fake.calls.map((c) => c.op)).toEqual(['DetectModerationLabels']);
  });

  it('throws when the provider fails (so the fail-closed chain never approves)', async () => {
    reply = () => ({
      status: 400,
      json: { __type: 'InvalidImageFormatException', message: 'bad image' },
    });
    await expect(adapter().inspect(webp)).rejects.toThrow();
  });
});
