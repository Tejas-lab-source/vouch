// @ts-check
import AxeBuilder from '@axe-core/playwright';

/**
 * Serious and critical axe violations on the page, as readable lines (empty when clean).
 * @param {import('@playwright/test').Page} page
 */
export async function seriousViolations(page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
