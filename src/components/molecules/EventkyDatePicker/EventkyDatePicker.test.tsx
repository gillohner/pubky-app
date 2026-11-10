import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EventkyDatePicker } from './EventkyDatePicker';

describe('EventkyDatePicker', () => {
  it('selects a Monday-first civil date and closes the popup', () => {
    const onChange = vi.fn();
    render(
      <>
        <label htmlFor="date">Move to date</label>
        <EventkyDatePicker id="date" value="2026-10-01" onChange={onChange} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Move to date' }));
    expect(
      screen.getAllByRole('button', { name: /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/ })[0],
    ).toHaveAccessibleName('Monday, September 28th, 2026');
    fireEvent.click(screen.getByRole('button', { name: /Friday, October 2nd, 2026/ }));
    expect(onChange).toHaveBeenCalledWith('2026-10-02');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });
  it('respects disabled form controls', () => {
    render(<EventkyDatePicker value="2026-10-01" onChange={vi.fn()} disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
