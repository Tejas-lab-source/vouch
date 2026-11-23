// @ts-check

/** Admin's own panels: user lookup, overdue deletions, feature flags and the audit log. */
export const adminPanels = [
  {
    id: 'admin.deletions',
    module: 'admin',
    title: 'Overdue deletions',
    roles: ['admin'],
    list: {
      endpoint: 'adminListOverdueDeletions',
      columns: [
        { field: 'userId', label: 'User', kind: 'user' },
        { field: 'deletedAt', label: 'Deleted', kind: 'timestamp' },
        { field: 'pendingConsumers', label: 'Not finished in', kind: 'json' },
      ],
    },
    detail: null,
    actions: [],
  },
  {
    id: 'admin.flags',
    module: 'admin',
    title: 'Feature flags',
    roles: ['admin'],
    list: {
      endpoint: 'adminListFlags',
      columns: [
        { field: 'key', label: 'Flag' },
        { field: 'enabled', label: 'On', kind: 'status' },
        { field: 'rules', label: 'Rules', kind: 'json' },
        { field: 'updatedAt', label: 'Changed', kind: 'timestamp' },
      ],
    },
    detail: null,
    actions: [],
  },
  {
    id: 'admin.audit-log',
    module: 'admin',
    title: 'Audit log',
    roles: ['admin'],
    list: {
      endpoint: 'adminListAuditLog',
      columns: [
        { field: 'createdAt', label: 'When', kind: 'timestamp' },
        { field: 'actorName', label: 'Who' },
        { field: 'action', label: 'Action' },
        { field: 'targetType', label: 'Target' },
        { field: 'targetId', label: 'Target id' },
      ],
    },
    detail: null,
    actions: [],
  },
];
