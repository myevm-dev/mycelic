# Mycelic payment design

Creation is 3 USDC. A post is 0.012 USDC. Joining, reading, and heartbeat updates are free. The configured receiver is `0x1f89928f6694dbd02fe77f9fdd7094a774f6d329`.

The default environment is Circle Gateway testnet. Arc Testnet is the preferred payment source, with other supported testnet networks advertised from the live Gateway `/v1/x402/supported` response and matched against the pinned SDK contracts. Browser payment networks are limited to chains configured in wagmi. Testnet and mainnet ledgers have separate database filenames. Mainnet requires an explicit enable flag and independent deployment review.

## Creation

1. The connected wallet signs a paid v3 room manifest and a one-hour room-scoped session certificate.
2. A session-signed `create` request is validated before payment. The server returns an x402 v2 challenge with a unique resource/intent URL.
3. The wallet signs a bounded EIP-3009 authorization to the treasury against the Gateway Wallet contract. The app checks the amount, recipient, chain, asset, domain and URL before asking for a signature.
4. The server validates the same fields and signature, assigns the authorization nonce durably, and calls Circle's `settle` API. Signature verification alone does not count as payment.
5. Gateway acceptance permits fulfillment. The ledger stores the room manifest and a creation receipt signed by the separate Mycelic receipt key. Gateway's later onchain batch finality is distinct from acceptance.

## Posting without repeated wallet prompts

An x402 purchase buys 10, 100 or 500 posting credits for 0.12, 1.20 or 6.00 USDC. Credits belong to the wallet, survive session changes and work across rooms on this deployment. These are prepaid, nonwithdrawable service credits, not Gateway balances or transferable tokens. The UI explains this distinction.

For each message, the temporary session key signs the message locally. The payment request submits the message ID and digest of the exact signed message. It includes a wallet-authorized session certificate and signed request envelope. The server deducts 12,000 micro-USDC once in an atomic Firestore or SQLite transaction and stores only the digest and signed receipt. The client sends the message, certificate and receipt directly over WebRTC. Both live messages and peer backfill validate the receipt. Room owners cannot issue valid receipts or disable the signed paid capability. The service trusts its receipt signer and ledger; this is not onchain verification by every peer.

The receipt binds service ID, environment, issuer, treasury, fee amount, room, sender, session, message ID and content digest. Session keys cannot move Gateway funds. The receipt key cannot spend treasury funds. Financial operations require wallet-signed, room-scoped session delegation and session-signed envelopes.

## Retries and recovery

- Room creation reserves its hash atomically before any Gateway submission. Competing requests resume the original intent. Unpaid expired claims can be released; uncertain paid claims cannot.
- Creation and pack purchases use stable intent IDs. A Gateway authorization nonce is assigned to only one operation. Accepted results are stored and returned again without charging.
- If the Gateway response is interrupted or the process crashes after submission, the intent stays pending. Retry triggers a nonce lookup through Gateway transfer history and matches payer, recipient, amount and network before fulfilling once. The app must not create a replacement authorization while acceptance is uncertain.
- Post IDs bind to content and identity. Retrying a post returns the existing receipt, without another deduction. Concurrent deductions are atomic and cannot overdraw.
- A paid receipt authorizes posting, not proof that every recipient received it. Disconnected peers, crashes, and lost client drafts can still prevent delivery. No automated refund mechanism is implemented.
- Payment attempt metadata and a pending creation draft are recovered in the same browser tab. Do not change the treasury, service ID, receipt key or environment on an existing deployment without a migration.
- Preserve the Firestore ledger and receipt key, or retain the SQLite database, WAL files and receipt key on persistent disk. Losing the ledger loses credits and attribution. Use the included ledger inspection/reconciliation command for pending requests. Never export chat text because the service does not store it.

## Enforcement boundary

Compliant Mycelic clients only join registered paid v3 rooms and accept posts with valid receipts. Two cooperating modified clients can communicate separately without paying. No service can remotely kill an arbitrary direct P2P link. Fee enforcement covers participation in official Mycelic rooms.

## Before accepting real USDC

- Run the funded testnet flow with your browser wallet: deposit, create, purchase, send, replay, restart and withdraw remaining Gateway funds.
- Verify receipt-key stability, database backup/recovery, reconciliation and accounting exports.
- Configure a stable HTTPS origin, service ID, allowed chains, fresh TURN credentials and signaling relays.
- Add production request/rate limits, monitoring, refunds/support policies and externally reviewed payment authorization/accounting.
- Load test the chosen room cap on mobile and restrictive networks. Larger rooms need a different topology.

References: [Circle seller quickstart](https://developers.circle.com/gateway-nanopayments/quickstarts/seller), [buyer quickstart](https://developers.circle.com/gateway-nanopayments/quickstarts/buyer), [reconciliation](https://developers.circle.com/gateway-nanopayments/howtos/x402-seller-reconciliation).

## Operational hardening

Gateway calls have 15-second timeouts. Unknown or nonce-conflict settlement outcomes remain pending for reconciliation. Status checks never authorize a replacement payment. Both backends use transactions, pin the payment identity and preserve room admission leases across process restarts. Firestore uses shared documents for room capacity and nonce uniqueness so multiple server instances cannot overspend credits or settle one intent twice. Official clients acquire admission before WebRTC and posts require a live lease before credit deduction. Request and wallet limits reduce bounded abuse; distributed attacks still require host controls. See [deployment and restore instructions](deployment.md).

## Payer and treasury must differ

Circle Gateway rejects `self_transfer`: a payment cannot have the same sender and recipient. Use a different payer wallet when testing your own treasury. The UI and server block this before payment authorization. Joining and reading are still free for the treasury wallet.

Known Gateway rejections such as `insufficient_balance`, `authorization_expired` and `self_transfer` are recorded as failed only when the response has no transfer identifier. Unknown outcomes and `nonce_already_used` remain pending for reconciliation. The original nonce is retained.

For older pending self-transfer attempts, retry the same operation after updating. Recovery first queries Gateway for the original nonce; an accepted record takes precedence. If no record exists and the stored authorization pays its own sender, the app records the documented rejection, issues no room or credits, and clears only that rejected creation draft. No new settlement or payment signature is requested by this recovery. A fresh room requires a different payer/owner wallet. Preserve the treasury and pinned payment identity.
