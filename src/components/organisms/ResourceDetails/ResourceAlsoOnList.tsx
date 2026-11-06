'use client';

import { usePinakesGroup } from '@/hooks/usePinakesGroup/usePinakesGroup';
import { getAlsoOnName, getAlsoOnNote, getHttpUrl } from '@/molecules/ResourceCard/ResourceCard.utils';
import { ResourceListRow } from '@/molecules/ResourceCard/ResourceListRow';
import type { TPinakesResourceDetail } from '@/services/pinakes/pinakes.types';
import { ResourceAlsoOnLanguagesRow } from './ResourceAlsoOnLanguagesRow';
import { getAlsoOnSource, mergeAlsoOn } from './ResourceAlsoOnList.utils';
import { ResourceSection } from './ResourceSection';

interface ResourceAlsoOnListProps {
  /** The page's card: its `also_on`, its `group`, and its own service and links (left out of the list). */
  card: Pick<TPinakesResourceDetail, 'id' | 'uri' | 'site' | 'refs' | 'aliases' | 'also_on' | 'group' | 'open_in'>;
}

/**
 * Also on, in full on the page: the same thing on other services, one row per service, each the
 * service's icon and name and opening it (only `http(s)` entries become links out, any other URI is
 * listed as text with its identifier). The rows are the card's `also_on` and its group's other
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
  if (rows.length === 0) return null;

  return (
    <ResourceSection
      title="Also on"
      count={rows.length}
      description="The same thing on other services"
      testId="resource-also-on-list"
    >
      {rows.map((row, index) => {
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
            href={getHttpUrl(row.entry.uri)}
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
