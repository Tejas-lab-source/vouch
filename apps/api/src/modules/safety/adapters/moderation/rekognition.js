// @ts-check
import {
  DetectFacesCommand,
  DetectModerationLabelsCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import sharp from 'sharp';

const CONNECT_TIMEOUT_MS = 2_000;
const REQUEST_TIMEOUT_MS = 4_000;

/**
 * `ModerationProvider` on Amazon Rekognition (ADR 0013), in `MODERATION_AWS_REGION`
 * (ap-south-1, Mumbai). Rekognition accepts JPEG and PNG only, so the WebP variant is
 * re-encoded to JPEG in memory first. Moderation labels and (optionally) face age ranges are
 * requested in parallel; any failure throws, and the fail-closed chain never approves.
 * @param {{
 *   region: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   endpoint?: string,
 *   minConfidence: number,
 *   faceAgeCheck: boolean,
 * }} options  `minConfidence` is the review threshold: weaker labels are not returned.
 * @returns {import('../../ports.js').ModerationProvider}
 */
export function createRekognitionModeration({
  region,
  accessKeyId,
  secretAccessKey,
  endpoint,
  minConfidence,
  faceAgeCheck,
}) {
  const client = new RekognitionClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 2,
    requestHandler: { connectionTimeout: CONNECT_TIMEOUT_MS, requestTimeout: REQUEST_TIMEOUT_MS },
    ...(endpoint ? { endpoint } : {}),
  });

  return {
    name: 'rekognition',
    async inspect(image) {
      const jpeg = await sharp(image).jpeg({ quality: 90 }).toBuffer();
      const [moderation, faces] = await Promise.all([
        client.send(
          new DetectModerationLabelsCommand({
            Image: { Bytes: jpeg },
            MinConfidence: minConfidence,
          }),
        ),
        faceAgeCheck
          ? client.send(
              new DetectFacesCommand({ Image: { Bytes: jpeg }, Attributes: ['AGE_RANGE'] }),
            )
          : Promise.resolve(null),
      ]);
      return {
        labels: (moderation.ModerationLabels ?? []).map((label) => ({
          name: label.Name ?? '',
          parent: label.ParentName || null,
          confidence: label.Confidence ?? 0,
        })),
        faces: (faces?.FaceDetails ?? []).map((face) => ({
          ageHigh: face.AgeRange?.High ?? null,
        })),
      };
    },
  };
}
