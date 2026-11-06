'use client';

import { type ReactNode, useId } from 'react';
import { getResourceRoute } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/atoms/DropdownMenu/DropdownMenu';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { MENU_VARIANT, type MenuVariant } from '@/config/ui';
import { cn } from '@/libs/utils/utils';
import type { TPinakesAlsoOn } from '@/services/pinakes/pinakes.types';
import { dedupeAlsoOn, groupAlsoOn } from './ResourceAlsoOn.utils';
import { ResourceAlsoOnLanguages } from './ResourceAlsoOnLanguages';
import { getAlsoOnName, getAlsoOnNote, getDisplayLink, getHttpUrl } from './ResourceCard.utils';
import { ResourceSourceIcon } from './ResourceSourceIcon';

const LABEL_CLASS_NAME = 'text-xs font-medium tracking-wide text-muted-foreground uppercase';
// The text of the post's ⋯ menu items (`PostMenuActionList`).
const ROW_TEXT_CLASS_NAME =
  'truncate text-base font-medium text-muted-foreground transition-colors group-hover:text-foreground group-focus:text-foreground';

interface ResourceAlsoOnProps {
  /** The card's `also_on`: the same thing on other services, tagged members first, then derived links. */
  alsoOn: TPinakesAlsoOn[];
  /** Where it renders: the ⋯ dropdown or the ⋯ bottom sheet on a phone. */
  variant: MenuVariant;
  /** Closes the ⋯ menu once a link is followed (the sheet; a dropdown item closes its menu itself). */
  closeMenu: () => void;
}

/**
 * Where else the external resource is, as the last section of its card's ⋯ menu: a separator, a
 * small "Also on" label naming the group, then one row per service in the post menu's style (the
 * service's favicon and name on one line). A service listed twice (Discogs found via Wikidata and via
 * MusicBrainz) is one row, and one listed in several languages (`Wikipedia (ar)` … `Wikipedia (zh)`)
 * is one row with a language switcher (`ResourceAlsoOnLanguages`). Nothing when the card is on one
 * site only. The card's own site is not listed: its header links it.
 *
 * Every row opens that link's page on Pubky (its tags, replies and player), not the service:
 * leaving for the service happens there ("Open in"). A link that is not a web link (`isbn:`, a DOI)
 * keeps its identifier after the service's name. A link's note (an archived copy's date, the source
 * a derived link was found through) is in its accessible name only. Menu items in the dropdown; in
 * the sheet, plain links that close it once followed.
 */
export function ResourceAlsoOn({ alsoOn, variant, closeMenu }: ResourceAlsoOnProps) {
  const labelId = useId();
  if (alsoOn.length === 0) return null;

  const rows = groupAlsoOn(dedupeAlsoOn(alsoOn)).map((row, index) =>
    row.kind === 'languages' ? (
      <ResourceAlsoOnLanguages
        key={`${index}-${row.name}`}
        name={row.name}
        editions={row.editions}
        variant={variant}
        renderRow={({ entry }) => <AlsoOnRow entry={entry} variant={variant} onFollow={closeMenu} />}
      />
    ) : (
      <AlsoOnRow key={`${index}-${row.entry.uri}`} entry={row.entry} variant={variant} onFollow={closeMenu} />
    ),
  );

  if (variant === MENU_VARIANT.SHEET) {
    return (
      <Container
        overrideDefaults
        role="group"
        aria-labelledby={labelId}
        data-testid="resource-also-on"
        className="flex flex-col gap-2 border-t border-border pt-4"
      >
        <Typography as="p" overrideDefaults id={labelId} className={cn('px-4', LABEL_CLASS_NAME)}>
          Also on
        </Typography>
        {rows}
      </Container>
    );
  }

  return (
    <>
      {/* Edge to edge across the content's `p-4`, like a separator in a menu with no padding. */}
      <DropdownMenuSeparator className="-mx-4 my-0" />
      <DropdownMenuLabel id={labelId} className={cn('p-0', LABEL_CLASS_NAME)}>
        Also on
      </DropdownMenuLabel>
      <DropdownMenuGroup aria-labelledby={labelId} data-testid="resource-also-on" className="flex flex-col gap-2.5">
        {rows}
      </DropdownMenuGroup>
    </>
  );
}

interface AlsoOnRowProps {
  entry: TPinakesAlsoOn;
  variant: MenuVariant;
  onFollow: () => void;
}

function AlsoOnRow({ entry, variant, onFollow }: AlsoOnRowProps) {
  const isWebLink = getHttpUrl(entry.uri) !== null;
  const href = getResourceRoute(entry.uri);
  const name = getAlsoOnName(entry);
  const note = isWebLink ? getAlsoOnNote(entry) : null;
  // The note follows the visible name, so the row is still found by what it shows.
  const label = note ? `${name}, ${note}` : undefined;
  // A URI that is not a web link (`isbn:`, `pubky://`) is told by its identifier, after the
  // service's name (a row named "DOI" alone says nothing).
  const identifier = isWebLink ? null : getDisplayLink(entry.uri);
  const content: ReactNode = (
    <>
      <ResourceSourceIcon uri={entry.uri} />
      <Typography as="span" overrideDefaults className={ROW_TEXT_CLASS_NAME}>
        {identifier && identifier !== name ? `${name} ${identifier}` : name}
      </Typography>
    </>
  );

  if (variant === MENU_VARIANT.SHEET) {
    return (
      <Button
        variant="ghost"
        asChild
        aria-label={label}
        data-testid="resource-also-on-row"
        className="group justify-start gap-2 overflow-hidden"
      >
        <Link href={href} overrideDefaults onClick={onFollow}>
          {content}
        </Link>
      </Button>
    );
  }

  return (
    <DropdownMenuItem asChild aria-label={label} data-testid="resource-also-on-row" className="group gap-2 p-0">
      <Link href={href} overrideDefaults>
        {content}
      </Link>
    </DropdownMenuItem>
  );
}
