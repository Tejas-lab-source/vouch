// @ts-check
import { useUpdateProfile } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Input, Text, useTheme } from '@vouch/ui-native';
import { useState } from 'react';
import { View } from 'react-native';
import { Choice } from '../../shared/ui/Choice.jsx';

/** Gender codes (contracts `GENDER`) and their labels. */
export const GENDERS = /** @type {const} */ ([
  [0, 'gender.woman'],
  [1, 'gender.man'],
  [2, 'gender.nonBinary'],
]);

/** @typedef {{ profile: import('@vouch/features-core').OwnProfile, onSaved?: () => void, submitLabel?: string }} FormProps */

/** @param {{ text: string }} props */
function Label({ text }) {
  const { space } = useTheme();
  return (
    <Text variant="label" style={{ marginBottom: space[2] }}>
      {text}
    </Text>
  );
}

/** @param {{ error: unknown }} props */
function Failed({ error }) {
  const { colors } = useTheme();
  return error ? (
    <Text accessibilityRole="alert" color={colors.dangerText}>
      {t('common.error')}
    </Text>
  ) : null;
}

/** Name and gender. @param {FormProps} props */
export function BasicsForm({ profile, onSaved, submitLabel = t('common.continue') }) {
  const update = useUpdateProfile();
  const [name, setName] = useState(profile.name ?? '');
  const [gender, setGender] = useState(/** @type {0 | 1 | 2 | null} */ (profile.gender));
  return (
    <View>
      <Input
        label={t('profile.name.label')}
        hint={t('profile.name.hint')}
        value={name}
        maxLength={50}
        autoComplete="given-name"
        onChangeText={setName}
      />
      <Label text={t('profile.gender.label')} />
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {GENDERS.map(([code, key]) => (
          <Choice
            key={code}
            label={t(key)}
            selected={gender === code}
            onPress={() => setGender(code)}
          />
        ))}
      </View>
      <Failed error={update.error} />
      <Button
        title={submitLabel}
        loading={update.isPending}
        disabled={!name.trim() || gender === null}
        onPress={() =>
          gender !== null &&
          update.mutate({ name: name.trim(), gender }, { onSuccess: () => onSaved?.() })
        }
      />
    </View>
  );
}

/** The genders to see. @param {FormProps} props */
export function InterestedInForm({ profile, onSaved, submitLabel = t('common.continue') }) {
  const update = useUpdateProfile();
  const [chosen, setChosen] = useState(() => new Set(profile.interestedIn));
  return (
    <View>
      <Label text={t('profile.interestedIn.label')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {GENDERS.map(([code, key]) => (
          <Choice
            key={code}
            kind="checkbox"
            label={t(key)}
            selected={chosen.has(code)}
            onPress={() => {
              const next = new Set(chosen);
              if (next.has(code)) next.delete(code);
              else next.add(code);
              setChosen(next);
            }}
          />
        ))}
      </View>
      <Failed error={update.error} />
      <Button
        title={submitLabel}
        loading={update.isPending}
        disabled={chosen.size === 0}
        onPress={() =>
          update.mutate({ interestedIn: [...chosen].sort() }, { onSuccess: () => onSaved?.() })
        }
      />
    </View>
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
    <View>
      <Input
        label={t('profile.ageRange.min')}
        keyboardType="number-pad"
        value={minAge}
        onChangeText={setMin}
      />
      <Input
        label={t('profile.ageRange.max')}
        keyboardType="number-pad"
        value={maxAge}
        error={valid ? null : t('profile.ageRange.invalid')}
        onChangeText={setMax}
      />
      <Failed error={update.error} />
      <Button
        title={submitLabel}
        loading={update.isPending}
        disabled={!valid}
        onPress={() =>
          update.mutate({ minAge: min, maxAge: max }, { onSuccess: () => onSaved?.() })
        }
      />
    </View>
  );
}

/** The bio (optional). @param {FormProps} props */
export function BioForm({ profile, onSaved, submitLabel = t('profile.save') }) {
  const { colors } = useTheme();
  const update = useUpdateProfile();
  const [bio, setBio] = useState(profile.bio ?? '');
  return (
    <View>
      <Input
        label={t('profile.bio.label')}
        hint={t('profile.bio.hint')}
        value={bio}
        maxLength={500}
        multiline
        onChangeText={setBio}
      />
      <Failed error={update.error} />
      {update.isSuccess ? (
        <Text accessibilityLiveRegion="polite" color={colors.successText}>
          {t('profile.saved')}
        </Text>
      ) : null}
      <Button
        title={submitLabel}
        loading={update.isPending}
        onPress={() => update.mutate({ bio: bio.trim() || null }, { onSuccess: () => onSaved?.() })}
      />
    </View>
  );
}
