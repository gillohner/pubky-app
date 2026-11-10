import { fireEvent, render, screen } from '@testing-library/react';
import { useForm, useWatch } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import type { EventkyPostFormData } from '@/hooks/useEventkyPostForm/useEventkyPostForm.types';
import { getEventkyFormDefaults } from '@/hooks/useEventkyPostForm/useEventkyPostForm.utils';
import { EventkyContributorPicker } from './EventkyContributorPicker';

const search = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useSearchAutocomplete/useSearchAutocomplete', () => ({
  useSearchAutocomplete: (input: { query: string }) => {
    search(input);
    return {
      users: input.query === 'Eventky staging guest' ? [{ id: 'guest', name: 'Eventky staging guest' }] : [],
      isLoading: false,
    };
  },
}));
vi.mock('@/hooks/useUserDetailsFromIds/useUserDetailsFromIds', () => ({
  useUserDetailsFromIds: () => ({ users: [{ id: 'guest', name: 'Eventky staging guest' }] }),
}));
function Harness() {
  const form = useForm<EventkyPostFormData>({ defaultValues: getEventkyFormDefaults('calendar') });
  const selected = useWatch({ control: form.control, name: 'contributors' });
  return (
    <>
      <EventkyContributorPicker state={{ form }} />
      <output data-testid="selection">{selected}</output>
    </>
  );
}
describe('EventkyContributorPicker', () => {
  it('searches full names containing spaces and selects the native user identity', () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Find contributors' }), {
      target: { value: 'Eventky staging guest' },
    });
    expect(search).toHaveBeenLastCalledWith({ query: 'Eventky staging guest', enabled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Eventky staging guest' }));
    expect(screen.getByTestId('selection')).toHaveTextContent('guest');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Eventky staging guest' }));
    expect(screen.getByTestId('selection')).toBeEmptyDOMElement();
  });
});
