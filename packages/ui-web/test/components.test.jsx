// @ts-check
import { readFile } from 'node:fs/promises';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildCss, paths } from '../scripts/build-css.js';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Heart,
  IconButton,
  Illustration,
  Input,
  ListItem,
  Modal,
  OtpInput,
  Skeleton,
  StatusBadge,
  Toast,
  Wordmark,
} from '../src/index.js';

describe('ui-web components', () => {
  it('Button: a real button, busy while loading, disabled when asked', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    rerender(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(/** @type {HTMLButtonElement} */ (button).disabled).toBe(true);
  });

  it('Input: labelled; hint and error are announced through aria-describedby', () => {
    render(<Input label="College email" hint="Use your college address" error="Not allowed" />);
    const input = screen.getByLabelText('College email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Use your college address',
      'Not allowed',
    ]);
    expect(screen.getByRole('alert').textContent).toBe('Not allowed');
  });

  it('OtpInput: one numeric field with one-time-code autofill; keeps digits only', () => {
    const Harness = () => {
      const [value, setValue] = useState('');
      return <OtpInput label="Six-digit code" value={value} onChange={setValue} />;
    };
    render(<Harness />);
    const input = /** @type {HTMLInputElement} */ (screen.getByLabelText('Six-digit code'));
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    fireEvent.change(input, { target: { value: '12a3456789' } });
    expect(input.value).toBe('123456');
  });

  it('Avatar: an image with alt text, or initials exposed as an image', () => {
    const { rerender } = render(<Avatar src="https://cdn/x.webp" alt="Asha" />);
    expect(screen.getByRole('img', { name: 'Asha' }).tagName).toBe('IMG');
    rerender(<Avatar alt="Asha Rao" name="Asha Rao" />);
    expect(screen.getByRole('img', { name: 'Asha Rao' }).textContent).toBe('AR');
  });

  it('Modal: a labelled dialog with a close button; Escape (cancel) closes', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Report" onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Report' });
    expect(dialog.hasAttribute('open')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent(dialog, new Event('cancel'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Toast: a status for info, an alert for errors, with a dismiss button', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast message="Saved" onDismiss={onDismiss} />);
    expect(screen.getByRole('status').textContent).toContain('Saved');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalledOnce();
    rerender(<Toast message="Failed" tone="error" />);
    expect(screen.getByRole('alert').textContent).toContain('Failed');
  });

  it('ListItem is a button only when clickable; Card, Badge, EmptyState and Skeleton render', () => {
    const onClick = vi.fn();
    const { container } = render(
      <>
        <ListItem title="Asha" subtitle="Hi there" onClick={onClick} />
        <ListItem title="Static" />
        <Card as="section">Card body</Card>
        <Badge tone="accent" label="3 unread">
          3
        </Badge>
        <EmptyState title="Nothing yet" body="Come back later" />
        <Skeleton height={20} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Asha/ }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByLabelText('3 unread').textContent).toBe('3');
    expect(screen.getByRole('heading', { name: 'Nothing yet' })).toBeTruthy();
    expect(container.querySelector('.v-skeleton')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('design components: status badges, chips, icon buttons, the wordmark and illustrations', () => {
    const onLike = vi.fn();
    const { container } = render(
      <>
        <StatusBadge status="verified">Verified</StatusBadge>
        <StatusBadge status="pending">Pending review</StatusBadge>
        <StatusBadge status="rejected">Rejected</StatusBadge>
        <Chip>Northfield</Chip>
        <IconButton icon={Heart} label="Like" variant="primary" onClick={onLike} />
        <Wordmark height={40} />
        <Illustration name="campus" />
      </>,
    );
    // The text carries the meaning; the icons are hidden from screen readers.
    expect(screen.getByText('Verified').className).toContain('v-status--verified');
    expect(container.querySelectorAll('.v-status svg[aria-hidden="true"]')).toHaveLength(3);
    expect(screen.getByText('Northfield').className).toBe('v-chip');
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    expect(onLike).toHaveBeenCalledOnce();
    expect(screen.getByRole('img', { name: 'Vouch' }).tagName.toLowerCase()).toBe('svg');
    const art = /** @type {HTMLImageElement} */ (container.querySelector('.v-illustration'));
    expect(art.getAttribute('alt')).toBe('');
    expect(art.getAttribute('loading')).toBe('lazy');
    // A file URL, or inlined as a data URL by the bundler (small SVGs).
    expect(art.getAttribute('src')).toMatch(/campus-placeholder\.svg|^data:image\/svg/);
  });

  it('Toast: success and error tones show an icon; OtpInput shows six boxes', () => {
    const { container } = render(
      <>
        <Toast message="Profile updated" tone="success" />
        <OtpInput label="Six-digit code" value="12" onChange={() => {}} />
      </>,
    );
    expect(container.querySelector('.v-toast__icon svg')).toBeTruthy();
    expect(container.querySelectorAll('.v-otp__box')).toHaveLength(6);
    expect(container.querySelector('.v-otp__box--active')?.textContent).toBe('');
  });

  it('the shipped styles.css is up to date and has both themes, focus rings and 44 px targets', async () => {
    const root = process.cwd();
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this package's own file
    const shipped = await readFile(paths(root).styles, 'utf8');
    expect(shipped).toBe(await buildCss(root));
    expect(shipped).toContain("[data-theme='dark']");
    expect(shipped).toContain('prefers-color-scheme: dark');
    expect(shipped).toContain(':focus-visible');
    expect(shipped).toContain('min-width: var(--touch-target)');
    expect(shipped).toContain('--color-primary: #D62828;');
  });
});
