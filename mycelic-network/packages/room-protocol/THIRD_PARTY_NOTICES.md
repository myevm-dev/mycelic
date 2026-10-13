# Third-party notices

## Chitchatter

Author: Jeremy Kahn and Chitchatter contributors.

Source: https://github.com/jeremyckahn/chitchatter

Revision inspected: `23b62a8d95be003e490e5a050335e1dea4b79cc7` on `develop`.

License: GPL-2.0-or-later. Full license text is in `LICENSE`.

Adapted source: `src/lib/PeerRoom/PeerRoom.ts` into `src/mesh/PeerRoom.ts`. The wrapper retains lifecycle handler maps, Trystero room creation, peer enumeration, action creation and leave cleanup. Media hooks and streaming queues are omitted; Nostr replaces BitTorrent, and typed text actions use the current Trystero API.

In v0.2, the reusable `packages/room-protocol/src/trystero.ts` adapter also uses this lifecycle wrapper pattern and adds scoped subscriptions and authenticated-session media plumbing. The original wrapper remains as a compatibility source file. The SDK's GPL license and this notice are included inside its package directory for redistribution.

## Trystero

Author: Dan Motzenbecker and contributors.

Source: https://github.com/dmotz/trystero

License: MIT. Installed package license notices remain part of the dependency distribution.

Other dependencies retain their respective package licenses. No Chitchatter logo, screenshots or branding assets are included.
