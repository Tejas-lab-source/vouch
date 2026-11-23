// @ts-check
import shared, { frontend } from '@vouch/config/eslint';

export default [{ ignores: ['dist/**'] }, ...shared, ...frontend];
