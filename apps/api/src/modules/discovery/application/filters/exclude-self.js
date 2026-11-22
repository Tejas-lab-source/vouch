// @ts-check
import { filterStep } from './filter.js';

/** Never show viewers themselves. */
export const excludeSelf = () =>
  filterStep(
    'discovery.excludeSelf',
    10,
    'self',
    ({ viewer }) =>
      (c) =>
        c.userId !== viewer.userId,
  );
