// @ts-check
import { useUpdateProfile } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Input } from '@vouch/ui-web';
import { useId, useState } from 'react';

/** Gender codes (contracts `GENDER`) and their labels. */
export const GENDERS = /** @type {const} */ ([
  [0, 'gender.woman'],
  [1, 'gender.man'],
  [2, 'gender.nonBinary'],
]);

/**
 * @typedef {{ profile: import('@vouch/features-core').OwnProfile, onSaved?: () => void, submitLabel?: string }} FormProps
 */

/** @param {unknown} error */
const failed = (error) => (error ? t('common.error') : null);

/** Name and gender. @param {FormProps} props */
export function BasicsForm({ profile, onSaved, submitLabel = t('common.continue') }) {
  const update = useUpdateProfile();
  const [name, setName] = useState(profile.name ?? '');
  const [gender, setGender] = useState(/** @type {number | null} */ (profile.gender));
  const legend = useId();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || gender === null) return;
        update.mutate(
          { name: name.trim(), gender: /** @type {any} */ (gender) },
          { onSuccess: () => onSaved?.() },
        );
      }}
    >
      <Input
        label={t('profile.name.label')}
        hint={t('profile.name.hint')}
        value={name}
        maxLength={50}
        autoComplete="given-name"
        required
        onChange={(event) => setName(event.target.value)}
      />
      <fieldset className="w-fieldset" aria-labelledby={legend}>
        <legend id={legend} className="v-field__label">
          {t('profile.gender.label')}
        </legend>
        {GENDERS.map(([code, key]) => (
          <label key={code} className="w-check">
            <input
              type="radio"
              name="gender"
              value={code}
              checked={gender === code}
              onChange={() => setGender(code)}
              required
            />
            {t(key)}
          </label>
        ))}
      </fieldset>
      {update.isError ? (
        <p className="v-field__error" role="alert">
          {failed(update.error)}
        </p>
      ) : null}
      <Button
        type="submit"
        block
        loading={update.isPending}
        disabled={!name.trim() || gender === null}
      >
        {submitLabel}
      </Button>
    </form>
  );
}

/** The genders to see. @param {FormProps} props */
export function InterestedInForm({ profile, onSaved, submitLabel = t('common.continue') }) {
  const update = useUpdateProfile();
  const [chosen, setChosen] = useState(() => new Set(profile.interestedIn));
  const legend = useId();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen.size === 0) return;
        update.mutate(
          { interestedIn: /** @type {any} */ ([...chosen].sort()) },
          { onSuccess: () => onSaved?.() },
        );
      }}
    >
      <fieldset className="w-fieldset" aria-labelledby={legend} aria-describedby={`${legend}-hint`}>
        <legend id={legend} className="v-field__label">
          {t('profile.interestedIn.label')}
        </legend>
        <p id={`${legend}-hint`} className="v-field__hint">
          {t('profile.interestedIn.hint')}
        </p>
        {GENDERS.map(([code, key]) => (
          <label key={code} className="w-check">
            <input
              type="checkbox"
              checked={chosen.has(code)}
              onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) next.add(code);
                else next.delete(code);
                setChosen(next);
              }}
            />
            {t(key)}
          </label>
        ))}
      </fieldset>
      {update.isError ? (
        <p className="v-field__error" role="alert">
          {failed(update.error)}
        </p>
      ) : null}
      <Button type="submit" block loading={update.isPending} disabled={chosen.size === 0}>
        {submitLabel}
      </Button>
    </form>
  );
}

/** The age range (18–99). @param {FormProps} props */
export function AgeRangeForm({ profile, onSaved, submitLabel = t('common.continue') }) {
  const update = useUpdateProfile();
  const [minAge, setMin] = useState(String(profile.minAge));
  const [maxAge, setMax] = useState(String(profile.maxAge));
  const min = Number(minAge);
  const max = Number(maxAge);
  const valid =
    Number.isInteger(min) && Number.isInteger(max) && min >= 18 && max <= 99 && min <= max;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        update.mutate({ minAge: min, maxAge: max }, { onSuccess: () => onSaved?.() });
      }}
    >
      <div className="w-row">
        <Input
          label={t('profile.ageRange.min')}
          type="number"
          inputMode="numeric"
          min={18}
          max={99}
          value={minAge}
          onChange={(event) => setMin(event.target.value)}
        />
        <Input
          label={t('profile.ageRange.max')}
          type="number"
          inputMode="numeric"
          min={18}
          max={99}
          value={maxAge}
          error={valid ? null : t('profile.ageRange.invalid')}
          onChange={(event) => setMax(event.target.value)}
        />
      </div>
      {update.isError ? (
        <p className="v-field__error" role="alert">
          {failed(update.error)}
        </p>
      ) : null}
      <Button type="submit" block loading={update.isPending} disabled={!valid}>
        {submitLabel}
      </Button>
    </form>
  );
}

/** The bio (optional, profile screen only). @param {FormProps} props */
export function BioForm({ profile, onSaved, submitLabel = t('profile.save') }) {
  const update = useUpdateProfile();
  const [bio, setBio] = useState(profile.bio ?? '');
  const id = useId();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ bio: bio.trim() || null }, { onSuccess: () => onSaved?.() });
      }}
    >
      <div className="v-field">
        <label className="v-field__label" htmlFor={id}>
          {t('profile.bio.label')}
        </label>
        <textarea
          id={id}
          className="v-input w-textarea"
          maxLength={500}
          rows={4}
          value={bio}
          aria-describedby={`${id}-hint`}
          onChange={(event) => setBio(event.target.value)}
        />
        <p id={`${id}-hint`} className="v-field__hint">
          {t('profile.bio.hint')}
        </p>
      </div>
      {update.isSuccess ? <p role="status">{t('profile.saved')}</p> : null}
      <Button type="submit" loading={update.isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}
