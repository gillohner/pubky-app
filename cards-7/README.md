# PR 7 (music enrichment) screenshots, 2026-11-04

Build: gillohner/pubky-app `cards/7-music-enrichment` @ e0ef81f1 plus the review-only `/cards-preview` page
(scripts/cards-preview-page7.tsx, not committed), `next start` on pinakes-lab.

Data: real responses of the Pinakes music-enrichment candidate (:8094, v2/music-enrichment-1 @ 75a43683),
captured with curl on the pinakes machine and answered to the page's own fetches in the browser, because
:8094 sits behind Coder sign-in. Nothing in the app was changed for this.

- cards-preview-{1440,390}: the default-size card (as in a post) for album, artist, band, two songs, sparse artist; compact Sources line.
- page-*-{1440,390}: resource pages with the full Sources block and links (Wikipedia, Commons file, license).
