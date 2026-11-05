import { cn } from '@/libs/utils/utils';
import { ResourceSourceIcon } from './ResourceSourceIcon';

interface ResourceRowContentProps {
  /** The URI the row's icon is read from. */
  uri: string;
  name: string;
  /** A second line under the name, or `null` for none. */
  note: string | null;
  /**
   * `menu`: a row of a card's menu. `sidebar`: a row of the resource page's sidebar cards, styled as
   * a participant on a post's page (`UserListItem` compact): the icon in an avatar-sized circle, the
   * name in bold, the note in small capitals.
   */
  variant?: 'menu' | 'sidebar';
}

/** What a row of a resource list shows (a card's menus, the resource page): icon, name and note. */
export function ResourceRowContent({ uri, name, note, variant = 'menu' }: ResourceRowContentProps) {
  const isSidebar = variant === 'sidebar';
  return (
    <>
      {isSidebar ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <ResourceSourceIcon uri={uri} />
        </span>
      ) : (
        <ResourceSourceIcon uri={uri} />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-foreground', isSidebar && 'text-sm font-bold')}>{name}</span>
        {/* The space keeps name and note apart in the row's accessible name; a flex column does not render it. */}
        {note && (
          <>
            {' '}
            <span
              className={cn(
                'truncate text-xs text-muted-foreground',
                isSidebar && 'font-medium tracking-[1.2px] uppercase',
              )}
            >
              {note}
            </span>
          </>
        )}
      </span>
    </>
  );
}
