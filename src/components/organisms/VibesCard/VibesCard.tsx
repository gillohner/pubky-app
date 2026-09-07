'use client';

import { WandSparkles } from 'lucide-react';
import { FilterHeader, FilterRoot } from '@/atoms/Filter/Filter';
import { SidebarButton } from '@/atoms/SidebarButton/SidebarButton';
import { VIBES_URL } from '@/config/vibes';
import { useVibesAlert } from '@/hooks/useVibesAlert/useVibesAlert';

/** Permanent sidebar entry point, available even after the home alert is dismissed. */
export function VibesCard() {
  const { tryVibes } = useVibesAlert();

  return (
    <FilterRoot data-testid="vibes-card">
      <FilterHeader title="Experimental" subtitle="Get a taste of the future." />
      <SidebarButton icon={WandSparkles} asChild>
        <a href={VIBES_URL} target="_blank" rel="noopener noreferrer" onClick={tryVibes}>
          Pubky Vibes
        </a>
      </SidebarButton>
    </FilterRoot>
  );
}
