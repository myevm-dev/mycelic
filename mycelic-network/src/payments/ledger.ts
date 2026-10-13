import { canonical, type PaymentPolicy } from "@/types/protocol";

export type IntentRow = {
  id: string;
  owner: string;
  kind: "create" | "credits";
  data: string;
  amount: string;
  expires: number;
  status: string;
  nonce: string | null;
  payload: string | null;
  result: string | null;
  error: string | null;
};
export type LedgerRecords = {
  rooms: { hash: string; definition: string; receipt: string };
  credits: { wallet: string; amount: number };
  posts: { room: string; id: string; digest: string; receipt: string };
  intents: IntentRow;
  creation_claims: { room: string; intent: string };
  nonces: { nonce: string; intent: string };
  settings: { name: string; value: string };
  room_leases: {
    room: string;
    members: Record<string, { lease: string; expires: number }>;
  };
  rate_windows: { bucket: string; window: number; count: number };
};
export type LedgerCollection = keyof LedgerRecords;
export interface LedgerTransaction {
  get<C extends LedgerCollection>(
    collection: C,
    key: string,
  ): Promise<LedgerRecords[C] | undefined>;
  set<C extends LedgerCollection>(
    collection: C,
    key: string,
    record: LedgerRecords[C],
  ): void;
  delete(collection: LedgerCollection, key: string): void;
}
export const postKey = (room: string, id: string) => JSON.stringify([room, id]);
export const identityError = () =>
  new Error(
    "Payment identity differs from the ledger. Restore the original receipt key, treasury and service ID, or perform a reviewed migration.",
  );

/** Server-side payment and admission metadata. Never accepts chat text or secrets. */
export abstract class PaymentLedger {
  abstract readonly backend: "sqlite" | "firestore";
  abstract transaction<T>(
    fn: (tx: LedgerTransaction) => Promise<T>,
  ): Promise<T>;
  abstract get<C extends LedgerCollection>(
    collection: C,
    key: string,
  ): Promise<LedgerRecords[C] | undefined>;
  abstract list<C extends LedgerCollection>(
    collection: C,
  ): Promise<LedgerRecords[C][]>;
  abstract close(): Promise<void>;

  async pinPolicy(policy: PaymentPolicy) {
    await this.transaction(async (tx) => {
      const wanted = canonical(policy);
      const pinned = await tx.get("settings", "payment-policy");
      const migration = await tx.get("settings", "sqlite-import");
      if (migration && JSON.parse(migration.value).status !== "completed")
        throw new Error(
          "Payment ledger migration is incomplete. Finish the original import before accepting payments.",
        );
      if (pinned && pinned.value !== wanted) throw identityError();
      if (!pinned)
        tx.set("settings", "payment-policy", {
          name: "payment-policy",
          value: wanted,
        });
    });
  }
  async balance(wallet: string) {
    return (await this.get("credits", wallet.toLowerCase()))?.amount || 0;
  }
  async rateLimit(
    wallet: string,
    group: string,
    limit: number,
    now = Date.now(),
  ) {
    const window = Math.floor(now / 60000),
      bucket = `${group}:${wallet.toLowerCase()}`;
    return this.transaction(async (tx) => {
      const current = await tx.get("rate_windows", bucket);
      if (current?.window === window && current.count >= limit) return false;
      tx.set("rate_windows", bucket, {
        bucket,
        window,
        count: current?.window === window ? current.count + 1 : 1,
      });
      return true;
    });
  }
  async acquireLease(
    room: string,
    actor: string,
    lease: string,
    capacity: number,
    now = Date.now(),
  ) {
    return this.transaction(async (tx) => {
      const current = await tx.get("room_leases", room);
      const members = Object.fromEntries(
        Object.entries(current?.members || {}).filter(
          ([, m]) => m.expires > now,
        ),
      );
      const identity = actor.toLowerCase();
      if (!members[identity] && Object.keys(members).length >= capacity)
        return false;
      members[identity] = { lease, expires: now + 45000 };
      tx.set("room_leases", room, { room, members });
      return true;
    });
  }
  async releaseLease(room: string, actor: string, lease: string) {
    await this.transaction(async (tx) => {
      const current = await tx.get("room_leases", room);
      const identity = actor.toLowerCase();
      if (current?.members[identity]?.lease !== lease) return;
      delete current.members[identity];
      tx.set("room_leases", room, current);
    });
  }
  async hasLease(room: string, actor: string, now = Date.now()) {
    return (
      ((await this.get("room_leases", room))?.members[actor.toLowerCase()]
        ?.expires || 0) > now
    );
  }
  async leaseCount(room: string, now = Date.now()) {
    return Object.values(
      (await this.get("room_leases", room))?.members || {},
    ).filter((m) => m.expires > now).length;
  }
}
