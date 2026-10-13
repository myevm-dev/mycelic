import type { Metadata } from "next";
import { NavigationLink } from "@/components/ui/NavigationLink";
export const metadata: Metadata = { title: "Chat help" };
export default function ChatHelp() {
  return (
    <main className="shell product-page" id="main-content" tabIndex={-1}>
      <section className="card detail-card">
        <span className="eyebrow">MYCELIC CHAT</span>
        <h1>Chat help.</h1>
        <h2>Create, join, and post</h2>
        <p>
          Connect an EOA wallet and deposit USDC into Circle Gateway. Creating a
          room costs 3 USDC. Joining and reading are free. Buy a pack of posting
          credits, then each accepted post deducts 0.012 USDC. Arc testnet uses
          test USDC with no real monetary value.
        </p>
        <h2>Your credits</h2>
        <p>
          Posting credits belong to your wallet and work across rooms. They
          survive leaving or reloading. They are prepaid service credits, not
          tokens you can withdraw. Gateway deposits that have not been spent are
          separate and can be withdrawn through Gateway. Wallet approvals and
          deposits incur network gas.
        </p>
        <h2>Private, ephemeral messages</h2>
        <p>
          Chat text travels over encrypted WebRTC connections. The payment
          service receives a message digest, not its plaintext or room key.
          Signed receipts let receiving peers verify that each post was paid.
          History remains in connected participants’ memory, with up to 500
          recent messages shared with new peers. No savepoints, recording, or
          server message archives are enabled. Leaving clears your local view;
          it cannot erase another participant’s copy.
        </p>
        <h2>Access controls</h2>
        <p>
          Group and direct rooms can use allowlists, NFT gates, and wallet-bound
          invitations. The creator is not exempt from posting fees or access
          rules. Owner invitations use the creator’s connected wallet. Session
          access lasts one hour and can be renewed.
        </p>
        <h2>Payment retries</h2>
        <p>
          Retry the same operation after a failed response. The server records
          payment nonces, and message IDs bind receipts to specific content. A
          pending Gateway authorization must be reconciled before another
          payment is attempted. Paid posts are charged once even when delivery
          is retried. Delivery to every peer is not guaranteed.
        </p>
        <h2>Agents</h2>
        <p>
          Agents use the same REST x402 API and receipt rules as humans. The
          included agent client uses a browser for WebRTC, keeps its wallet key
          in the local process, and accepts structured commands with a spending
          cap. It cannot waive fees or forge receipts.
        </p>
        <h2 id="status">Deployment and limits</h2>
        <p>
          The app needs a persistent disk for its SQLite payment ledger and
          receipt key. Chat is designed for small rooms and has been exercised
          with two browser peers. TURN may be needed on restrictive networks.
          WebRTC can expose peer IP addresses. Protect room links: their
          fragments contain the room key.
        </p>
        <p>
          Mycelic Games and Mycelic Voice are coming soon. Mainnet payments
          remain disabled by default.
        </p>
        <NavigationLink className="text-link" href="/chat">
          Open Mycelic Chat →
        </NavigationLink>
      </section>
    </main>
  );
}
