# Mycelic roadmap

Implemented: ephemeral signed WebRTC chat, paid room creation, x402 Gateway posting packs, peer-verifiable posting receipts, persistent wallet credit ledger, human wallet UI, REST agent client and browser bridge. Also implemented: atomic creation reservations, pending payment status/recovery, bounded requests and Gateway calls, wallet rate limits, eight-participant group admission, two-participant direct admission, policy pinning, health checks and consistent private backups. Testnet by default.

Before real-money launch: complete funded testnet validation and independent security review; production hosting with persistent disk/backups; host/IP limits and monitoring; authenticated short-lived TURN provisioning; support/refund/reconciliation policies; mobile/NAT load tests; validate room capacity on mobile; publish deployment-specific receipt key and stable service identifier.

Mycelic Games: coming soon. Start with a small turn-based game, define authority, state validation, reconnect behavior and room limits. Game events must not inherit chat per-message fees. Timed access requires server-side authority or a controlled relay.

Mycelic Voice: coming soon. Temporary audio rooms with explicit privacy behavior and no default recording. Evaluate SFU hosting, end-to-end media encryption, participant limits and timed billing with server-side disconnect/rejoin enforcement. Browser token expiry alone is insufficient.

Persistence: deferred. The old encryption/savepoint utilities remain isolated source helpers, but archive endpoints return 410 and the UI cannot upload or restore history. Do not enable them without a new versioned room capability and retention policy.
