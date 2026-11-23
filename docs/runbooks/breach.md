# Runbook: personal data breach

- **Owner:** the incident lead, the first person who knows. Hand over explicitly if needed.
- **Law:** Digital Personal Data Protection Act 2023 and Rules 2025. Legal review is required
  before launch: confirm the deadlines and the notice content below with counsel.
- **Applies to:** any unauthorised access to, or disclosure, alteration, loss or destruction
  of, personal data. This includes data held by a processor: Render, Cloudflare, Resend, Expo
  or AWS.

## The 72-hour clock

The clock starts when we **become aware** of the breach, not when it is confirmed.

| When                | What                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| T+0                 | Open an incident (`incident.md`), severity SEV-1. Write down the time we became aware.                                                           |
| T+0 to T+4 h        | Contain (below). Preserve evidence. Do not delete logs.                                                                                          |
| **Without delay**   | **Intimation to the Data Protection Board** with what is known: nature, extent, timing, location, likely impact.                                 |
| **Without delay**   | **Tell each affected user**, in plain language (template below), through email and in the app.                                                   |
| **Within 72 hours** | **Detailed report to the Board**: facts, cause, mitigation, findings about the person responsible, remedial measures, the notices sent to users. |
| Within 7 days       | Post-incident review; fixes tracked to completion.                                                                                               |

If a processor reports a breach to us, the clock starts when we receive their report.

## 1. Contain

Pick what fits the breach:

- **Leaked or suspected keys:**
  - rotate the JWT signing keys: `pnpm dev:keys --rotate`, using the production secret store
  - rotate `EMAIL_HMAC_SECRET` only with a re-hash plan (it links emails to accounts)
  - rotate the R2 keys, the Resend key, the Expo token and the AWS keys at each provider
- **User sessions:** revoke every session by bumping the active key and retiring the old one
  at once (no grace window). Every user signs in again.
- **Staff sessions:** `UPDATE admin.sessions SET revoked_at = now() WHERE revoked_at IS NULL`.
  Every staff request fails at once (ADR 0026). Disable the staff accounts involved
  (`admin.admin_users.status`).
- **A leaking endpoint or feature:** turn it off with a feature flag, or deploy the previous
  image.
- **Storage:** make the bucket private and rotate the CDN signing settings. Check the R2
  access logs.
- **Database:** rotate the Postgres password, and check `pg_stat_activity` and the host's
  access logs.

## 2. Assess

- **What data:** which categories (`docs/data-model.md`)?
  - The most sensitive: messages, ID-card images, dates of birth.
  - Emails are stored only as an HMAC.
- **Whose data:** how many users, and which colleges? List the affected internal ids
  privately. Never paste personal data into tickets or chat.
- **When:** the first and last access. Use the host logs, request ids and the admin audit log
  (`GET /v1/admin/audit-log`).
- **How:** the root cause, and whether access is still possible.

## 3. Notify

- **Board:**
  - the intimation (without delay), then the detailed report within 72 hours
  - through the Board's prescribed channel
  - keep a copy of everything sent, with timestamps
- **Users:** use the template below and send it through the registered contact. If the
  college email is not stored, send it in the app and to the device's push channel. Ask
  counsel whether the email hash plus college records allow direct contact.
- **Processors:** where the breach involves a processor, get their incident report in
  writing.

### User notice template (draft: legal review)

> **Subject: Important: a security incident affecting your Vouch account**
>
> On [date] we discovered that [what happened, in one sentence]. The information involved
> was [categories]. [What it means for you: likely consequences.]
>
> What we have done: [containment, for example "signed every device out and fixed the cause"].
>
> What you can do: [for example, sign in again, review your profile, be careful of messages
> claiming to be from Vouch].
>
> If you have questions, contact our grievance officer, [name], at [grievance email]. You
> also have the right to complain to the Data Protection Board of India.

## 4. Recover and learn

- Restore any data that was altered or lost (`restore.md`).
- Write a blameless post-incident review within 7 days: the timeline, the cause, what
  worked, what did not, and actions with owners.
- Update `docs/security/threat-model.md` with the new threat and its control.
