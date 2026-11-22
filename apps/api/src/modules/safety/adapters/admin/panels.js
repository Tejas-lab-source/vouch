// @ts-check

/**
 * Safety's admin panels (manifest key `admin.panels`, extension point 11). The admin app
 * renders them generically: a list endpoint with columns, an optional detail endpoint, and
 * actions that call admin endpoints with fixed body fields.
 */
export const safetyPanels = [
  {
    id: 'safety.reports',
    module: 'safety',
    title: 'Reports',
    roles: ['moderator', 'admin'],
    list: {
      endpoint: 'adminListReports',
      columns: [
        { field: 'createdAt', label: 'Reported', kind: 'timestamp' },
        { field: 'reason', label: 'Reason' },
        { field: 'context', label: 'Where' },
        { field: 'targetId', label: 'Reported user', kind: 'user' },
        { field: 'status', label: 'Status', kind: 'status' },
      ],
    },
    detail: {
      endpoint: 'adminGetReport',
      fields: [
        { field: 'reason', label: 'Reason' },
        { field: 'evidence.note', label: 'Reporter’s note' },
        { field: 'evidence.card', label: 'Profile at report time', kind: 'json' },
        { field: 'evidence.messages', label: 'Last messages', kind: 'json' },
        { field: 'priorReportsAgainstTarget', label: 'Other reports against this user' },
      ],
    },
    actions: [
      {
        id: 'dismiss',
        label: 'Dismiss',
        endpoint: 'adminActOnReport',
        body: { action: 'dismiss' },
        needsNote: true,
      },
      {
        id: 'warn',
        label: 'Warn',
        endpoint: 'adminActOnReport',
        body: { action: 'warn' },
        needsNote: true,
      },
      {
        id: 'hide',
        label: 'Hide profile',
        endpoint: 'adminActOnReport',
        body: { action: 'hide' },
        needsNote: true,
        confirm: true,
      },
      {
        id: 'unhide',
        label: 'Unhide profile',
        endpoint: 'adminActOnReport',
        body: { action: 'unhide' },
        needsNote: true,
      },
      {
        id: 'ban',
        label: 'Ban user',
        endpoint: 'adminActOnReport',
        body: { action: 'ban' },
        needsNote: true,
        confirm: true,
        danger: true,
      },
    ],
  },
  {
    id: 'safety.photo-reviews',
    module: 'safety',
    title: 'Photo review',
    roles: ['moderator', 'admin'],
    list: {
      endpoint: 'adminListPhotoReviews',
      columns: [
        { field: 'urls.w400', label: 'Photo', kind: 'image' },
        { field: 'userId', label: 'User', kind: 'user' },
        { field: 'flaggedAt', label: 'Flagged', kind: 'timestamp' },
      ],
    },
    detail: null,
    actions: [
      {
        id: 'approve',
        label: 'Approve',
        endpoint: 'adminDecidePhoto',
        body: { decision: 'approve' },
      },
      {
        id: 'reject',
        label: 'Reject',
        endpoint: 'adminDecidePhoto',
        body: { decision: 'reject' },
        confirm: true,
        danger: true,
      },
    ],
  },
  {
    id: 'safety.verification-reviews',
    module: 'safety',
    title: 'ID verification',
    roles: ['moderator', 'admin'],
    list: {
      endpoint: 'adminListVerificationReviews',
      columns: [
        { field: 'idImageUrl', label: 'Student ID', kind: 'image' },
        { field: 'selfieImageUrl', label: 'Selfie', kind: 'image' },
        { field: 'userId', label: 'User', kind: 'user' },
        { field: 'submittedAt', label: 'Submitted', kind: 'timestamp' },
      ],
    },
    detail: null,
    actions: [
      {
        id: 'approve',
        label: 'Approve',
        endpoint: 'adminDecideVerification',
        body: { decision: 'approve' },
        confirm: true,
      },
      {
        id: 'reject',
        label: 'Reject',
        endpoint: 'adminDecideVerification',
        body: { decision: 'reject' },
        confirm: true,
      },
    ],
  },
  {
    id: 'safety.bans',
    module: 'safety',
    title: 'Bans',
    roles: ['admin'],
    list: {
      endpoint: 'adminListBans',
      columns: [
        { field: 'userId', label: 'User', kind: 'user' },
        { field: 'reason', label: 'Reason' },
        { field: 'createdAt', label: 'Banned', kind: 'timestamp' },
        { field: 'expiresAt', label: 'Ends', kind: 'timestamp' },
      ],
    },
    detail: null,
    actions: [{ id: 'lift', label: 'Lift ban', endpoint: 'adminLiftBan', confirm: true }],
  },
];
