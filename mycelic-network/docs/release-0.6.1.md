# Mycelic Chat 0.6.1

This release hardens the paid ephemeral chat flow while retaining the shared dark/light UI and Games/Voice coming-soon cards.

- Atomic room creation claims stop competing operation IDs from independently charging for one room. Uncertain authorizations stay pending for owner-only recovery.
- Human clients can check pending pack payments, and agents expose the `payments` command. Recovery reuses the original intent without authorizing another transfer.
- Gateway requests have deadlines and validate pinned USDC contracts and reconciliation fields.
- Durable leases admit eight group participants or two direct-room participants before mesh startup. Posts require admission before deduction.
- Bounded JSON streams, API concurrency and wallet request windows reduce resource abuse. Host-level distributed abuse controls remain necessary.
- Ledger policy pinning protects existing receipts from accidental signer/configuration changes. Online private backups and verification scripts accompany the health endpoint and Docker/Caddy configuration.

Validation: 47 unit tests, nine production-build browser tests, TypeScript, lint and a read-only live Circle testnet check. The browser suite uses an isolated Gateway fixture and real signatures/WebRTC. Docker was not available here. Live funded testnet settlement, host deployment, mobile capacity testing and independent review remain outstanding. Mainnet remains disabled by default.
