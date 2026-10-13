# Mycelic room core

Source-only GPL TypeScript package, consumed with Next.js transpilePackages. The core has signed manifests, wallet-certified session identities, scoped encrypted WebRTC transport, signed chat records, peer cleanup, and receipt verification. No blockchain, staking, consensus or anchor network is implemented.

Chat v3 (`ember.chat@3`) requires payment policy and service-signed receipts, checked for both live messages and backfill. Chat v2 remains available for independent free SDK integrations; the Mycelic app only registers paid v3 rooms. Legacy required capabilities fail closed when incompatible.

Use `assertPaymentPolicy` against a trusted service configuration and verify the creation receipt before joining. Do not trust a room owner's arbitrary receipt key. Each post receipt binds its exact signed message digest, session, sender, room, issuer, treasury, environment and fee. The local application module enforces signature validity; it does not independently inspect Circle's ledger.

Import `ChatModule` and the Trystero browser adapter explicitly. Supply your own trusted admission policy and transport when embedding the core elsewhere. Browser WebRTC is required by the bundled adapter. See the app's REST agent client and browser bridge for a runnable paid integration.

Old savepoint encryption helpers remain source utilities, but the current app disables archive endpoints and retains no message content on its server. Preserve the bundled license and Chitchatter attribution.
