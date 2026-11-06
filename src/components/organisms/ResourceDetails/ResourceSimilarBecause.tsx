'use client';

import { useRouter } from 'next/navigation';
import { APP_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Popover, PopoverContent, PopoverTrigger } from '@/atoms/Popover/Popover';
import { Tag } from '@/atoms/Tag/Tag';
import { useBulkUserAvatars } from '@/hooks/useBulkUserAvatars/useBulkUserAvatars';
import { useResourceTags } from '@/hooks/useResourceTags/useResourceTags';
import { AvatarGroup } from '@/molecules/AvatarGroup/AvatarGroup';
import { WhoTaggedExpandedList } from '@/molecules/WhoTaggedExpandedList/WhoTaggedExpandedList';
import type { TPinakesBecause } from '@/services/pinakes/pinakes.types';
import { becauseLabel, topTags } from './ResourceSimilarBecause.utils';

interface ResourceSimilarBecauseProps {
  /** Why Pinakes suggests the row (`because` of a `related` search row). */
  because: TPinakesBecause;
  /** The link whose tags are shown: the row's most referenced link (`refs[0]`), else its `uri`. */
  tagUri: string;
  /** The row's name, for the accessible name. */
  name: string;
}

/**
 * Under a Similar row: why it is suggested, from the app's own parts. The shared taggers as an
 * `AvatarGroup` (the named ones, `+N` for the rest, as on a hot tag) and the row's top tags as `Tag`
 * chips (the shared people's own first; a chip searches its tag, as on Hot tags). Pressing the avatars opens the post tags' who-tagged list (`WhoTaggedExpandedList`: avatar,
 * name, profile, follow) of the named people. The full sentence is the button's accessible name.
 */
export function ResourceSimilarBecause({ because, tagUri, name }: ResourceSimilarBecauseProps) {
  const router = useRouter();
  const { getUsersWithAvatars } = useBulkUserAvatars(because.taggers);
  const { tags } = useResourceTags(tagUri);
  const people = getUsersWithAvatars(because.taggers);
  const top = topTags(tags, because.taggers);
  // Nobody named: nothing says why, so no line.
  if (people.length === 0) return null;
  const handleTagClick = (label: string) => router.push(`${APP_ROUTES.SEARCH}?tags=${encodeURIComponent(label)}`);
  const group = <AvatarGroup items={people} totalCount={because.shared} maxAvatars={because.taggers.length} />;

  return (
    <span className="flex max-w-full min-w-0 flex-wrap items-center gap-2" data-testid="resource-similar-because">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            overrideDefaults
            type="button"
            aria-label={becauseLabel({ shared: because.shared, name, top })}
            data-testid="resource-similar-because-people"
            className="flex cursor-pointer items-center transition-opacity hover:opacity-80"
          >
            {group}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={4}
          aria-label={`Who tagged this and ${name}`}
          className="w-auto p-0"
        >
          <WhoTaggedExpandedList taggerIds={because.taggers} fallbackTaggers={people} />
        </PopoverContent>
      </Popover>
      {top.map((label) => (
        <Tag key={label} name={label} onClick={handleTagClick} />
      ))}
    </span>
  );
}
