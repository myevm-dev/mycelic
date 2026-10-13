# Hosting and funded testing

Use Vercel with the transactional shared Firestore backend, or one long-running Node.js 24 instance with persistent SQLite storage. See [Firestore and Vercel setup](firestore.md) for credentials, security rules, migration and emulator tests. Firestore shares credits, intent reservations, nonces, rates and admission across server instances. Do not run multiple independent SQLite ledgers behind a load balancer. Chat text and room keys stay with peers.

## Container deployment

The included Dockerfile builds the application and runs it as a non-root user. Compose adds Caddy for HTTPS and a named ledger volume. Docker execution was not available in the development environment; validate this configuration on the target host before exposing it publicly.

```bash
cp deploy/production.env.example .env.production
```

Edit `.env.production` locally. Set the domain, matching HTTPS public URL, permanent service ID, and a fresh private receipt signing key in your secret manager. Keep the configured treasury address. The receipt signer is a separate operational key, never your treasury private key. Retain testnet and the disabled mainnet flag for the first deployment. No keys are bundled.

```bash
docker compose --env-file .env.production -f deploy/compose.yaml up -d --build
```

Configure DNS and ports 80/443. Supply reliable Nostr relays and STUN at build time. The supplied container arguments cover those two settings. The existing static TURN variables can help controlled tests, but public production TURN needs an authenticated runtime endpoint that issues short-lived credentials; that endpoint is still outstanding. Public browser configuration is embedded by Next.js during the build. Rebuild when those values change. Do not expose a reusable TURN secret as a public variable.

`GET /api/health` checks configuration, ledger access and the pinned payment identity. It returns 503 if the signer or service policy changed. It does not assert Gateway connectivity or a funded balance. Use external monitoring for both health and Gateway availability. Add reverse-proxy/IP limits for distributed floods. Built-in controls bound request bodies to 100 KB, concurrent API work to 32, wallet operations to 240/minute, metadata to 120/minute and payment status to 30/minute. They are operational limits, not a Sybil defense.

Official clients admit at most eight wallet participants in a group and two in a direct room. Admission leases renew and expire after 45 seconds. A network outage closes official clients after the renewal grace period. One wallet counts as one admission slot; multiple tabs with that wallet can contend for it. Mesh limits apply to accepted application peers, not every transport connection a malicious client might attempt. Test capacity on phones and restrictive networks before increasing it.

## Consistent private SQLite backups

For Firestore, configure managed backups or exports and preserve the receipt signer in your secret manager. The commands below intentionally refuse Firestore instead of exporting an inconsistent live snapshot.

Run in the configured service environment:

```bash
npm run backup -- /PRIVATE_NEW_BACKUP_DIRECTORY
npm run backup:verify -- /PRIVATE_NEW_BACKUP_DIRECTORY
```

The backup uses SQLite's online snapshot API and includes the ledger, private receipt key and public identity. Store the whole directory encrypted with restricted access. Never publish it with the source ZIP. Each target must be a new directory. In Docker, execute the script inside the chat container and copy the private directory to protected storage.

For a restore drill, stop writes, verify the backup, restore `ledger.sqlite` as `mycelic-testnet.sqlite` in a new protected data directory, and restore the original receipt key through the host's secret configuration. For mainnet the filename is `mycelic-mainnet.sqlite`. Preserve treasury, environment, service ID and public origin. Start only one writer. Check health, a known wallet balance, room registration and an existing paid receipt. Do not overwrite a live database or leave stale WAL/SHM files from a different database beside the restored snapshot.

The ledger pins the payment policy to prevent accidental signer replacement from invalidating existing rooms and credits. Changing the treasury, receipt signer or service ID requires a reviewed migration. Keep pending intents available for reconciliation rather than discarding them.

## Funded testnet acceptance checklist

The automated Gateway fixture does not prove live payment settlement. Use a dedicated browser wallet with test USDC and complete this flow before considering mainnet:

1. Deposit a bounded amount through the UI. Confirm the transaction, then refresh until Gateway reports available funds.
2. Create one room for 3 test USDC. Verify the Gateway transfer recipient matches the treasury and one room receipt is issued.
3. Buy a ten-post pack for 0.12 test USDC. Verify the Mycelic ledger balance is 120,000 micro-USDC.
4. Join with another wallet. Exchange paid posts and verify a 12,000 deduction per unique message. Retry the same message ID without a second deduction.
5. Interrupt a payment response. Use **Check pending payments** in the room, or the agent `payments` command. Confirm that reconciliation resolves the original intent without another payment signature. Pending creation can be resumed with the original creation draft.
6. Fill the two-participant direct room, then try an additional wallet. Confirm admission fails and no post credit is deducted.
7. Restart the service and confirm balances and room receipts remain valid. Rejoin while a peer remains to confirm backfill. Close all peers and verify there is no archive to restore.
8. Run the backup/restore drill in an isolated copy. Withdraw unused Gateway funds through Circle's documented flow; Mycelic posting credits themselves are nonwithdrawable.
9. Repeat create, pack and posting with the supplied agent CLI, including its spending cap. Review settlement accounting, support/refund policy, mobile networking and external security review before enabling real USDC.

No deployment or real-funds transaction is included in this release.
