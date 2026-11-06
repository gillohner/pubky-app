'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getResourceRoute } from '@/app/routes';
import { usePinakesGroup } from '@/hooks/usePinakesGroup/usePinakesGroup';
import { getAlsoOnName, getAlsoOnNote } from '@/molecules/ResourceCard/ResourceCard.utils';
import { ResourceListRow } from '@/molecules/ResourceCard/ResourceListRow';
import type { TPinakesResourceDetail } from '@/services/pinakes/pinakes.types';
import { ResourceAlsoOnLanguagesRow } from './ResourceAlsoOnLanguagesRow';
import { getAlsoOnSource, mergeAlsoOn } from './ResourceAlsoOnList.utils';
import { ResourceSection } from './ResourceSection';

interface ResourceAlsoOnListProps {
  /** The page's card: its `also_on`, its `group`, and its own service and links (left out of the list). */
  card: Pick<TPinakesResourceDetail, 'id' | 'uri' | 'site' | 'refs' | 'aliases' | 'also_on' | 'group' | 'open_in'>;
}

/** Rows shown before "Show N more": a long list (a track on a dozen services) stays calm. */
export const ALSO_ON_VISIBLE_ROWS = 5;

/**
 * Also on, on the page: the same thing on other services, one row per service, each the service's
 * icon and name (a link that is not a web link keeps its identifier), opening that link's own page
 * on Pubky (its tags, replies and player); leaving for the service happens there ("Open in"). The
 * first `ALSO_ON_VISIBLE_ROWS` show, the rest behind "Show N more" in the sidebar card's footer
 * (never "Show 1 more": one row over the limit shows). The rows are the card's `also_on` and its group's other
 * members (`mergeAlsoOn`): Pinakes' best link of each service, the links people shared on Pubky
 * for a service it has none for, never the card's own service (the card's header opens it). Where a
 * link came from is in its tooltip, not on the row. A service in several languages
 * (`Wikipedia (ar)` … `Wikipedia (zh)`) is one row with a language select, as in the menu. The
 * group is the read the page's "Tags on other services" makes; until it is read, or when it fails,
 * Also on stands alone. Nothing for a resource on no other service; the count names the rows.
 */
export function ResourceAlsoOnList({ card }: ResourceAlsoOnListProps) {
  const { data: group } = usePinakesGroup(card.group?.id);
  const rows = mergeAlsoOn(card, group?.members);
  const [isExpanded, setIsExpanded] = useState(false);
  if (rows.length === 0) return null;
  // "Show 1 more" would take the row's own place: a list one longer than the limit shows whole.
  const hidden = rows.length > ALSO_ON_VISIBLE_ROWS + 1 ? rows.length - ALSO_ON_VISIBLE_ROWS : 0;
  const visibleRows = isExpanded || hidden === 0 ? rows : rows.slice(0, ALSO_ON_VISIBLE_ROWS);

  return (
    <ResourceSection
      title="Also on"
      count={rows.length}
      description="The same thing on other services"
      testId="resource-also-on-list"
      footer={
        hidden > 0
          ? {
              icon: isExpanded ? ChevronUp : ChevronDown,
              text: isExpanded ? 'Show less' : `Show ${hidden} more`,
              onClick: () => setIsExpanded((value) => !value),
              expanded: isExpanded,
            }
          : undefined
      }
    >
      {visibleRows.map((row, index) => {
        if (row.kind === 'languages') {
          return (
            <ResourceAlsoOnLanguagesRow
              key={`${index}-${row.name}`}
              name={row.name}
              editions={row.editions}
              testId="resource-also-on-list-row"
            />
          );
        }
        return (
          <ResourceListRow
            key={`${index}-${row.entry.uri}`}
            uri={row.entry.uri}
            href={getResourceRoute(row.entry.uri)}
            name={getAlsoOnName(row.entry)}
            // A link that is not a web link keeps its identifier (`10.1038/…` under DOI).
            note={getAlsoOnNote(row.entry, undefined, { withSource: false })}
            source={getAlsoOnSource(row.entry)}
            testId="resource-also-on-list-row"
          />
        );
      })}
    </ResourceSection>
  );
}
