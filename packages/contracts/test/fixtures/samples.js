// @ts-check
/** Shared sample values for fixtures. Synthetic only. */

export const ID = '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e5f';
export const ID2 = '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e60';
export const UUID4 = '3b241101-e2bb-4255-8caf-4136c566a962';
export const PUBLIC_ID = 'aB3dE5fG7hJ9kL1mN3pQ5r';
export const PUBLIC_ID2 = 'zY8xW6vU4tS2rQ0pO8nM6l';
export const TS = '2026-11-21T10:00:00Z';
export const CURSOR = 'eyJpZCI6MX0';
export const URL400 = 'https://cdn.example.com/photos/u/p_400.webp';
export const URL1080 = 'https://cdn.example.com/photos/u/p_1080.webp';

export const photoUrls = { w400: URL400, w1080: URL1080 };

export const card = {
  userId: PUBLIC_ID,
  name: 'Aditi',
  age: 21,
  gender: 0,
  collegeName: 'Northfield Institute of Technology',
  bio: null,
  photos: [photoUrls, photoUrls],
  sections: [],
};

export const message = {
  conversationId: ID,
  seq: 7,
  clientMsgId: UUID4,
  senderId: PUBLIC_ID,
  kind: 'text',
  body: 'hi there',
  createdAt: TS,
};

export const ownProfile = {
  userId: PUBLIC_ID,
  status: 'pending',
  name: null,
  gender: null,
  interestedIn: [],
  bio: null,
  age: 20,
  minAge: 18,
  maxAge: 30,
  photos: [{ id: ID, position: 0, status: 'pending', urls: null }],
  sections: [],
  missing: ['name', 'gender', 'interestedIn', 'photos'],
};

export const errorBody = { code: 'NOT_FOUND', message: 'Not found', requestId: 'req-1' };

export const tokens = {
  accessToken: 'eyJhbGciOiJFZERTQSJ9.e30.sig',
  accessTokenExpiresAt: TS,
  refreshToken: 'rt_abc',
  refreshTokenExpiresAt: TS,
};

export const ban = {
  banId: ID,
  userId: PUBLIC_ID,
  reason: 'harassment',
  createdAt: TS,
  expiresAt: null,
  liftedAt: null,
};

export const flag = {
  key: 'chat.links',
  enabled: true,
  rules: [{ type: 'percentage', percent: 10 }],
  updatedAt: TS,
};

export const reportSummary = {
  reportId: ID,
  status: 'open',
  context: 'chat',
  reason: 'harassment',
  reporterId: PUBLIC_ID,
  targetId: PUBLIC_ID2,
  createdAt: TS,
  closedAt: null,
};

export const reportDetail = {
  ...reportSummary,
  evidence: { card, messages: [message], note: null },
  priorReportsAgainstTarget: 0,
};

export const review = {
  reviewId: ID,
  userId: PUBLIC_ID,
  status: 'pending',
  idImageUrl: 'https://storage.example.com/id/abc?sig=1',
  submittedAt: TS,
  decidedAt: null,
};

export const candidate = {
  userId: ID,
  gender: 1,
  interestedIn: [0],
  age: 22,
  minAge: 18,
  maxAge: 26,
  lastActiveAt: TS,
  createdAt: TS,
  approvedPhotos: 3,
};

export const config = {
  minSupportedVersion: '1.0.0',
  latestVersion: '1.2.0',
  privacyNoticeVersion: '2026-11',
  flags: { 'chat.links': false },
  college: { id: ID, name: 'Northfield Institute of Technology', clusterId: ID2 },
  limits: {
    minPhotos: 2,
    maxPhotos: 6,
    maxUploadBytes: 10485760,
    messageMaxLength: 1000,
    bioMaxLength: 500,
    minAge: 18,
    maxAge: 99,
  },
  sectionTypes: [],
};
