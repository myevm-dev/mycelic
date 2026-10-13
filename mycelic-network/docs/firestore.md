# Firestore payments on Vercel

Chat remains ephemeral WebRTC. Firestore stores public room definitions, credit balances, payment intents, nonce ownership, post digests and receipts, rate windows, and admission leases. It never receives chat plaintext or room secrets. Circle Gateway remains the payment provider.

## Firebase setup

1. Create a dedicated Firebase project and a Cloud Firestore database in Native mode / Standard edition. Use the `(default)` database, or configure its database ID. Select a region close to your Vercel function region.
2. Publish the included `firestore.rules` through the Firebase console, or use the Firebase CLI to deploy Firestore rules. Browser clients have no direct access to the ledger. If sharing a project, merge the scoped rules carefully: a broader matching allow rule can grant access despite a scoped denial.
3. Create a dedicated service account with the Firestore data access role (`roles/datastore.user`) and obtain its credentials through Firebase Project settings > Service accounts, or Google Cloud IAM. The Admin SDK uses IAM and bypasses browser security rules. Keep credentials in your host's secret environment, never in GitHub or chat.
4. Configure the following in Vercel Project settings > Environment variables for Production. Use separate test credentials/namespaces for previews rather than pointing unreviewed previews at mainnet balances.

```dotenv
MYCELIC_STORAGE_BACKEND=firestore
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=your-service-account-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
MYCELIC_FIRESTORE_NAMESPACE=mycelic
MYCELIC_FIRESTORE_DATABASE_ID=(default)
MYCELIC_PUBLIC_URL=https://www.mycelic.space
MYCELIC_SERVICE_ID=your-existing-stable-service-id
MYCELIC_RECEIPT_PRIVATE_KEY=your-existing-receipt-signing-key
MYCELIC_TREASURY_ADDRESS=0x1f89928f6694dbd02fe77f9fdd7094a774f6d329
MYCELIC_PAYMENT_ENV=mainnet
MYCELIC_ENABLE_MAINNET=true
```

The key above is a placeholder. When entering `FIREBASE_PRIVATE_KEY` into Vercel, paste the actual PEM text without enclosing quote characters. Actual newlines or literal `\n` escapes are supported. These are server-only values: do not prefix any credential with `NEXT_PUBLIC_`. Preserve the existing receipt key and service ID when moving an existing ledger. The receipt key is separate from the Firebase key and the treasury wallet key. Never supply the treasury wallet private key to this app.

The public URL must exactly match the origin people use, including `www` if present. Redirect the alternate hostname to that origin. Configure testnet with `MYCELIC_PAYMENT_ENV=testnet` and `MYCELIC_ENABLE_MAINNET=false` for initial testing. Redeploy after changing environment values.

Vercel automatically selects Firestore if the backend variable is absent. It rejects an explicit SQLite configuration instead of writing temporary money records. `MYCELIC_DATA_DIR` is not used by Firestore. A production receipt key must still be supplied explicitly; no local key file is generated.

## Verification

Visit `/api/health` and `/api/payments/config` after redeploying. Both exercise the database and identity policy. Health should return HTTP 200 with `status: ready` when payments are enabled. This does not prove Gateway availability or funded settlement. Use the funded checklist in [deployment.md](deployment.md) and reconcile any pending authorization with its original intent.

Firestore ledger paths are `mycelic_ledgers/{namespace}-{testnet|mainnet}/{collection}/{hashed-key}`. Environment separation is automatic. Do not change the namespace or project to make an identity error disappear: doing so points users at a different ledger with no prior credits.

Transactions atomically reserve creation intents and payment nonces, fulfill a payment once, and deduct each post once. Gateway calls happen only after the nonce assignment commits, outside retryable Firestore transactions. Uncertain settlement outcomes retain the original intent for reconciliation. A room's leases share one transactionally updated document, so capacity remains consistent across function instances.

## Existing SQLite payments

A new mainnet ledger does not inherit testnet credits. If that environment has existing paid registrations or credits, stop all writers and preserve the original ledger before switching it to Firestore. An empty Vercel deployment that never accepted a payment can start with an empty Firestore namespace.

For an existing ledger:

1. Take and verify the private SQLite backup using `npm run backup` and `npm run backup:verify` on the original host. Keep the original database and signer protected.
2. Stop both old and new API writers for the import. Configure the Firebase credentials and the exact original payment environment, issuer key, treasury and service ID locally. Use the intended target namespace.
3. Import the frozen snapshot:

```bash
npm run storage:migrate -- /absolute/private/backup/ledger.sqlite --writers-stopped
```

The importer reads SQLite without modifying it. It requires matching policy and an empty target, preserves rooms, credits, post receipts, intents, creation reservations and nonce ownership, and never submits payments. If interrupted, rerun with the exact same snapshot. An incomplete migration blocks the normal API. Completed imports cannot be rerun or overwrite a used ledger. Ephemeral presence/rate windows are not imported; clients rejoin and renew admission.

4. Compare the reported counts and known wallet balances with the source; use `npm run payments:inspect` with the Firestore configuration. Only then enable the new writer and retire the old one. Do not run both ledgers accepting payments.

The importer assumes writers are stopped, as required by its explicit flag. It does not provide an online cross-database migration.

## Backups and cost

Configure managed Firestore backups / exports and test recovery in an isolated namespace. Preserve the receipt signer separately in a secret manager. `npm run backup` intentionally remains SQLite-only. Do not delete or apply TTL to credit balances, paid receipts, intent results, nonce assignments or creation claims. Room presence expires logically after 45 seconds. Rate-window records are reused per actor and may need an operator cleanup job as usage grows.

Firestore reads and writes have a separate infrastructure cost from Circle fees. Monitor usage and set billing alerts. Admin credentials grant access to financial metadata; limit IAM access. No Firebase browser SDK, browser API key, or Firebase login is needed for this backend.

## Local integration tests

Run a Firestore emulator using the Firebase CLI (current releases require Java 21), with the fixed demo project:

```bash
npx firebase-tools emulators:exec --only firestore --project demo-mycelic "npm run test:firestore"
```

Alternatively start the emulator separately, then:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 npm run test:firestore
```

The test command requires a loopback emulator and uses a `demo-` project, real signatures and a fake Gateway provider. It cannot submit a funded payment. Tests exercise independent database clients, simultaneous credit deductions, duplicate posts, uncertain payment recovery, nonce uniqueness, creation reservations, identity pinning, rollback and room capacity. The default unit suite skips these emulator tests when no emulator is configured.
