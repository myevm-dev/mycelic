# Validation scope

Unit tests cover signed rooms, session certificates, allowlists/NFT/invitation admission, capability negotiation, scoped transport, cleanup, encryption helpers, and paid chat receipt enforcement. Payment tests cover x402 challenges, correct fees/recipient/domain, forged authorizations, exact once crediting, nonce reuse, exhausted credits, changed content, concurrent deductions, creation receipts, and interrupted-response reconciliation.

Browser checks use an isolated fake Circle Gateway provider and real EOA signatures. They exercise human room creation, posting packs, exhausted-credit recovery, ephemeral departure/rejoin, credit retention, disabled archives, two real WebRTC peers with paid backfill, theme/navigation/mobile layouts, and the actual agent CLI exchanging paid records with a human. The agent test also checks its spending cap and same-message retry.

The fake provider is loaded only by the test process. Application payment code has no public mock mode and always validates authorizations before calling the configured Circle facilitator. No test uses the treasury's private key or moves real USDC.

A separate read-only live smoke check verifies Circle's supported network/contract response and transfer search endpoint. It does not fund a wallet, create an authorization or settle a payment. A funded browser/agent testnet flow and independent review remain required before real-money deployment.

The completed run passed 47 unit tests and nine browser tests against the production build. Type checking, lint and production build also passed. The existing viem/ox optional Tempo module produces a nonblocking webpack dynamic dependency warning.

The old savepoint utility tests verify isolated source helpers only. Archives are disabled in this application, so those helpers do not establish deployed persistence.

Hardening tests cover concurrent room reservations, unsigned owner-only payment recovery, identity pinning, chunked byte limits, stalled request deadlines, concurrency-slot cleanup, durable room admission, stale releases and wallet rate windows. The private backup scripts are exercised with a temporary generated signer and ledger, then independently verified. Docker configuration is supplied but was not executed here.

Browser hardening additionally drops an accepted pack response and checks recovery without a second payment authorization, plus health readiness and oversized API rejection. The read-only live Gateway check passed against seven supported testnet networks.
