// @ts-check

const LABEL_CHARS = /^[a-z0-9-]{1,63}$/;

/** @param {string} label */
const isLabel = (label) =>
  LABEL_CHARS.test(label) && !label.startsWith('-') && !label.endsWith('-');

/**
 * A DNS domain with at least two labels, each 1–63 characters of letters, digits and inner
 * hyphens.
 * @param {string} domain
 */
function isDomain(domain) {
  const labels = domain.split('.');
  return labels.length >= 2 && domain.length <= 253 && labels.every(isLabel);
}

/**
 * @typedef {object} NormalisedEmail
 * @property {string} address  The canonical address used for the HMAC.
 * @property {string} domain
 */

/**
 * Normalises a college email so one mailbox maps to one account:
 * trim, lowercase, and drop a `+tag` from the local part.
 * @param {string} raw
 * @returns {NormalisedEmail | null} null when the address is not a usable email.
 */
export function normaliseEmail(raw) {
  const lowered = raw.trim().toLowerCase();
  const parts = lowered.split('@');
  if (parts.length !== 2) return null;
  const [local = '', domain = ''] = parts;
  if (/\s/.test(lowered) || !isDomain(domain)) return null;
  const base = local.split('+')[0] ?? '';
  if (base.length === 0 || base.length > 64) return null;
  return { address: `${base}@${domain}`, domain };
}

/**
 * Finds the college whose listed email domains contain exactly this domain. Subdomains do
 * not match: alumni and staff often use them (owner decision, Phase 5).
 * @template {{ emailDomains: readonly string[] }} C
 * @param {string} domain
 * @param {readonly C[]} colleges
 * @returns {C | undefined}
 */
export function findCollegeForDomain(domain, colleges) {
  return colleges.find((college) =>
    college.emailDomains.some((listed) => listed.toLowerCase() === domain),
  );
}
