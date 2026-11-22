// @ts-check
import { mutuallyInterested } from '../../domain/deck.js';
import { filterStep } from './filter.js';

/** Both people's gender interests and age ranges must include each other. */
export const mutualPreferences = () =>
  filterStep(
    'discovery.mutualPreferences',
    50,
    'preferences',
    ({ viewer }) =>
      (c) =>
        mutuallyInterested(viewer, c),
  );
