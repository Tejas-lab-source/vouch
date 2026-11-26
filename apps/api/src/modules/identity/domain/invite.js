// @ts-check

/** Crockford base32: no I, L, O or U, so codes read aloud and typed by hand stay unambiguous. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 16 characters × 5 bits = 80 bits of randomness. */
export const INVITE_CODE_LENGTH = 16;

/** The flag that makes a college invite-only (a `campus` rule lists the colleges). */
export const INVITE_ONLY_FLAG = 'beta.invite_only';

/**
 * Formats random bytes as an invite code, `XXXX-XXXX-XXXX-XXXX`.
 * @param {Uint8Array} bytes  At least 16 bytes; each contributes its low 5 bits.
 */
export function formatInviteCode(bytes) {
  if (bytes.length < INVITE_CODE_LENGTH) throw new Error('need 16 random bytes');
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += ALPHABET.charAt((bytes.at(i) ?? 0) & 31);
    if (i % 4 === 3 && i < INVITE_CODE_LENGTH - 1) code += '-';
  }
  return code;
}

/**
 * The canonical form that is hashed: uppercase, without spaces or hyphens, with the
 * look-alikes I/L → 1 and O → 0 (Crockford). Null when it cannot be a code.
 * @param {string} raw
 * @returns {string | null}
 */
export function normaliseInviteCode(raw) {
  const compact = raw.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (compact.length !== INVITE_CODE_LENGTH) return null;
  for (const char of compact) if (!ALPHABET.includes(char)) return null;
  return compact;
}
