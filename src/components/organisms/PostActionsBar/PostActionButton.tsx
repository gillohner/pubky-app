'use client';

import type { ComponentProps, ComponentType } from 'react';
import { Button } from '@/atoms/Button/Button';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { cn } from '@/libs/utils/utils';
import { postActionsButtonVariants, postActionsCountVariants } from './PostActionsBar.variants';

type PostActionButtonProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size' | 'children' | 'aria-label'> & {
  icon: ComponentType<{ className?: string; strokeWidth?: number; fill?: string }>;
  /** Shown after the icon; nothing shows when absent (a count nobody has is never shown as 0). */
  count?: number | string;
  ariaLabel: string;
  variant?: 'default' | 'visual';
  /** What the row sits on: `muted` on an external resource card, so the pill stays visible there. */
  surface?: 'default' | 'muted';
  iconProps?: { fill?: string; className?: string };
  /** Makes the button a link to this in-app route; a disabled button never links. */
  href?: string;
};

/**
 * One button of a post's action row (tag, reply, repost, more): the icon and its count in a filled
 * pill. External resource cards use it too, so their row reads like the post's. Extra props (a
 * trigger's `asChild` props, `data-cy`, `title`) reach the button, so a menu can open from it.
 */
export function PostActionButton({
  icon: Icon,
  count,
  ariaLabel,
  variant = 'default',
  surface = 'default',
  iconProps,
  href,
  className,
  disabled,
  ...props
}: PostActionButtonProps) {
  const content = (
    <>
      <Icon {...iconProps} />
      {count !== undefined && (
        <Typography as="span" overrideDefaults className={postActionsCountVariants({ variant })}>
          {count}
        </Typography>
      )}
    </>
  );
  const buttonProps = {
    variant: 'secondary' as const,
    size: 'sm' as const,
    className: cn(postActionsButtonVariants({ variant, surface }), className),
    'aria-label': ariaLabel,
    ...props,
  };

  if (href && !disabled) {
    return (
      <Button asChild {...buttonProps}>
        <Link href={href} overrideDefaults>
          {content}
        </Link>
      </Button>
    );
  }

  return (
    <Button {...buttonProps} disabled={disabled}>
      {content}
    </Button>
  );
}
