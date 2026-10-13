import { verifyMessage, type Address, type Hex } from "viem";
import { getAppNftClient } from "@/chains/config";
export type MessageSigner = {
  address: Address;
  signMessage: (args: { message: string }) => Promise<Hex>;
};
import {
  canonical,
  unsigned,
  roomSchema,
  invitationSchema,
  certificateSchema,
  type AccessPolicy,
  type RoomDefinition,
  type SessionCertificate,
  type Invitation,
} from "@/types/protocol";

export const signRoom = async (
  body: Omit<RoomDefinition, "signature">,
  owner: MessageSigner,
): Promise<RoomDefinition> => {
  if (body.owner.toLowerCase() !== owner.address.toLowerCase())
    throw new Error("Owner mismatch");
  const room = {
    ...body,
    signature: await owner.signMessage({ message: canonical(body) }),
  };
  roomSchema.parse(room);
  return room;
};
export const verifyRoom = async (input: unknown): Promise<RoomDefinition> => {
  const room = roomSchema.parse(input);
  if (
    !(await verifyMessage({
      address: room.owner as Address,
      message: canonical(unsigned(room)),
      signature: room.signature as `0x${string}`,
    }))
  )
    throw new Error("Invalid room policy signature");
  return room;
};
export const issueInvitation = async (
  room: RoomDefinition,
  wallet: Address,
  expiresAt: number,
  owner: MessageSigner,
): Promise<Invitation> => {
  if (owner.address.toLowerCase() !== room.owner.toLowerCase())
    throw new Error("Only the room owner can invite");
  const body = {
    roomHash: room.hash,
    wallet,
    expiresAt,
    id: crypto.randomUUID(),
  };
  if (expiresAt <= Date.now())
    throw new Error("Invite must expire in the future");
  return {
    ...body,
    signature: await owner.signMessage({ message: canonical(body) }),
  };
};
export const verifyInvitation = async (
  room: RoomDefinition,
  identity: string,
  input: unknown,
): Promise<boolean> => {
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) return false;
  const invite = parsed.data;
  return (
    invite.roomHash === room.hash &&
    invite.wallet.toLowerCase() === identity.toLowerCase() &&
    invite.expiresAt > Date.now() &&
    (await verifyMessage({
      address: room.owner as Address,
      message: canonical(unsigned(invite)),
      signature: invite.signature as `0x${string}`,
    }))
  );
};
export const verifyCertificate = async (
  input: unknown,
  roomHash: string,
  at = Date.now(),
): Promise<SessionCertificate> => {
  const cert = certificateSchema.parse(input);
  if (
    cert.roomHash !== roomHash ||
    cert.expiresAt <= at ||
    cert.expiresAt > at + 86_400_000
  )
    throw new Error("Expired or invalid session");
  if (
    !(await verifyMessage({
      address: cert.identity as Address,
      message: canonical(unsigned(cert)),
      signature: cert.signature as `0x${string}`,
    }))
  )
    throw new Error("Invalid identity signature");
  return cert;
};
export const needsWallet = (policy: AccessPolicy): boolean =>
  !!(policy.allowlist.length || policy.nft || policy.inviteRequired);
export type NftBalanceReader = (
  policy: NonNullable<AccessPolicy["nft"]>,
  wallet: Address,
) => Promise<bigint>;
const requireNftBalance = (value: unknown): bigint => {
  if (typeof value !== "bigint" || value < 0n)
    throw new Error("Invalid NFT balance response");
  return value;
};
export const readNftBalance: NftBalanceReader = async (gate, wallet) => {
  const client = getAppNftClient(gate.chainId);
  if (gate.standard === "erc1155")
    return requireNftBalance(
      await client.readContract({
        address: gate.contract as Address,
        abi: [
          {
            type: "function",
            name: "balanceOf",
            stateMutability: "view",
            inputs: [
              { name: "account", type: "address" },
              { name: "id", type: "uint256" },
            ],
            outputs: [{ name: "", type: "uint256" }],
          },
        ] as const,
        functionName: "balanceOf",
        args: [wallet, BigInt(gate.tokenId!)],
      }),
    );
  if (gate.tokenId) {
    const owner = await client.readContract({
      address: gate.contract as Address,
      abi: [
        {
          type: "function",
          name: "ownerOf",
          stateMutability: "view",
          inputs: [{ name: "id", type: "uint256" }],
          outputs: [{ name: "", type: "address" }],
        },
      ] as const,
      functionName: "ownerOf",
      args: [BigInt(gate.tokenId)],
    });
    if (typeof owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(owner))
      throw new Error("Invalid NFT owner response");
    return owner.toLowerCase() === wallet.toLowerCase() ? 1n : 0n;
  }
  return requireNftBalance(
    await client.readContract({
      address: gate.contract as Address,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "owner", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
      ] as const,
      functionName: "balanceOf",
      args: [wallet],
    }),
  );
};
/** All configured gates are ANDed. NFT RPC errors deny admission. */
export const assertAccess = async (
  room: RoomDefinition,
  identity: string,
  invite?: Invitation,
  readBalance: NftBalanceReader = readNftBalance,
): Promise<void> => {
  if (
    room.policy.allowlist.length &&
    !room.policy.allowlist.some(
      (a) => a.toLowerCase() === identity.toLowerCase(),
    )
  )
    throw new Error("Wallet is not on this room allowlist");
  if (
    room.policy.inviteRequired &&
    !(await verifyInvitation(room, identity, invite))
  )
    throw new Error("A valid wallet-bound owner invitation is required");
  if (
    room.policy.nft &&
    (await readBalance(room.policy.nft, identity as Address)) <= 0n
  )
    throw new Error("Required NFT is not held by this wallet");
};
