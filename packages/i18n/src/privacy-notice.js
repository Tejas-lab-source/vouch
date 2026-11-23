// @ts-check

/**
 * The privacy notice, versioned (Phase 14, DPDP Act 2023 and Rules 2025). The server names the
 * current version (`PRIVACY_NOTICE_VERSION`, served in `GET /v1/config`); sign-up records which
 * version the student accepted (`identity.consents`). A new version is a new entry here: old
 * versions stay, so the text a student agreed to can always be shown again.
 *
 * LEGAL REVIEW REQUIRED before launch: this text is a structured draft written for the review,
 * not legal advice. Items in [brackets] are placeholders listed in the Phase 14 report's
 * "Before launch" section.
 */

/**
 * @typedef {object} NoticeSection
 * @property {string} heading
 * @property {string[]} paragraphs
 *
 * @typedef {object} PrivacyNotice
 * @property {string} version
 * @property {string} effectiveDate  ISO date
 * @property {'draft' | 'final'} status
 * @property {NoticeSection[]} sections
 */

/** Placeholders, shown as is until filled in before launch. */
export const NOTICE_PLACEHOLDERS = Object.freeze({
  company: '[Company legal name and registered address]',
  grievanceOfficer: '[Grievance officer name]',
  grievanceEmail: '[grievance@vouch.example]',
  supportEmail: '[support@vouch.example]',
});

const P = NOTICE_PLACEHOLDERS;

/** @type {PrivacyNotice} */
const V2026_11_DRAFT = {
  version: '2026-11-draft',
  effectiveDate: '2026-11-23',
  status: 'draft',
  sections: [
    {
      heading: 'Who we are',
      paragraphs: [
        `Vouch is run by ${P.company} (the "Data Fiduciary"). This notice explains what personal data we process, why, for how long, and your rights. Contact us at ${P.supportEmail}.`,
      ],
    },
    {
      heading: 'What we collect',
      paragraphs: [
        'Your college email address, used once to verify you are a student. We keep only a keyed fingerprint of it, never the address itself.',
        'Your date of birth (to confirm you are 18 or over), graduation year and college.',
        'Your profile: name, gender, who you are interested in, bio, profile sections you choose to fill in, and photos. Photos are re-encoded and their location and camera data removed.',
        'Your activity: likes and passes, matches, messages you send, blocks and reports you make, and device push tokens.',
        'If you verify with a student ID card: the ID image and a selfie, kept only until a moderator decides and then deleted within 30 days.',
        'Technical data needed to run the service securely: device type, app version, IP address in security logs, and request identifiers. Logs never contain your messages or contact details.',
      ],
    },
    {
      heading: 'Why we use it',
      paragraphs: [
        'To verify you are a student at your college, show your profile to other students on your campus, make matches, deliver messages and notifications, and keep the community safe (moderation of reports and photos, bans).',
        'We do not sell your data, show advertising, or use your messages for anything other than delivering them (and, if a message is reported, letting a moderator review the reported conversation).',
      ],
    },
    {
      heading: 'Your consent',
      paragraphs: [
        'We process your data on the basis of the consent you give when you sign up, for the purposes above. You can withdraw consent at any time by deleting your account in Settings. Withdrawing consent does not affect processing that took place before.',
        'Read receipts are off unless you turn them on, and only work when both people share them.',
      ],
    },
    {
      heading: 'Who processes it for us',
      paragraphs: [
        'We use service providers that process data only on our instructions: hosting and database (Render), photo storage and delivery (Cloudflare), email delivery (Resend), push notifications (Expo, Apple and Google), photo moderation (Amazon Web Services) and bot protection (Cloudflare Turnstile). Some of them may process data outside India, with safeguards required by law.',
      ],
    },
    {
      heading: 'How long we keep it',
      paragraphs: [
        'While your account is active. When you delete your account, your profile, photos, messages you sent, likes, blocks and settings are erased within 30 days. A match is anonymised, and the other person keeps their own messages.',
        'Kept longer, only where needed: records of your consent (as proof), reports about you and bans (for safety, report evidence deleted one year after the report closes), and security logs (up to 90 days).',
      ],
    },
    {
      heading: 'Your rights',
      paragraphs: [
        'You can access a copy of your data (Settings → Download my data), correct your profile at any time, erase your data by deleting your account, and nominate another person to exercise your rights if you die or become unable to.',
        `You can raise a grievance with our grievance officer, ${P.grievanceOfficer}, at ${P.grievanceEmail}. We respond within 30 days. If you are not satisfied, you can complain to the Data Protection Board of India.`,
      ],
    },
    {
      heading: 'Age',
      paragraphs: [
        'Vouch is only for students aged 18 or over. We do not knowingly process data of children; an account found to belong to someone under 18 is removed.',
      ],
    },
    {
      heading: 'Security and breaches',
      paragraphs: [
        'Data is encrypted in transit and at rest with our providers. If a personal data breach affects you, we will tell you and the Data Protection Board without delay, as the law requires.',
      ],
    },
    {
      heading: 'Changes to this notice',
      paragraphs: [
        'If we change how we use your data, we will publish a new version here and ask for your consent again where the law requires it.',
      ],
    },
  ],
};

/** Every published version, by version id. */
export const PRIVACY_NOTICES = Object.freeze(new Map([[V2026_11_DRAFT.version, V2026_11_DRAFT]]));

/** The version the clients ship with (the server's PRIVACY_NOTICE_VERSION must name one). */
export const LATEST_PRIVACY_NOTICE = V2026_11_DRAFT.version;

/**
 * The notice for a version, or null when this build does not ship it (the app must be
 * updated): a student is only asked to agree to text they can read.
 * @param {string | null | undefined} version
 * @returns {PrivacyNotice | null}
 */
export function privacyNotice(version) {
  return (version ? PRIVACY_NOTICES.get(version) : undefined) ?? null;
}
