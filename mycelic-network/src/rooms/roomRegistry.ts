import {
  type RoomDefinition,
  type RoomMetadata,
  type ArchiveHead,
} from "@/types/protocol";
type RecordState = {
  room: RoomDefinition;
  archives: ArchiveHead[];
  leases: Map<string, { actor: string; expiresAt: number }>;
};
/** Development room directory with local archive heads and presence leases. */
export class RoomRegistry {
  readonly rooms = new Map<string, RecordState>();
  constructor(private clock = () => Date.now()) {}
  create(room: RoomDefinition, actor: string): void {
    if (room.owner.toLowerCase() !== actor.toLowerCase())
      throw new Error("Only owner can create");
    if (this.rooms.has(room.hash)) throw new Error("Room already exists");
    this.rooms.set(room.hash, { room, archives: [], leases: new Map() });
  }
  private requireRoom(roomHash: string): RecordState {
    const room = this.rooms.get(roomHash);
    if (!room) throw new Error("Room not found");
    return room;
  }
  heartbeat(roomHash: string, actor: string, leaseId: string): void {
    const room = this.requireRoom(roomHash);
    room.leases.set(`${actor.toLowerCase()}:${leaseId}`, {
      actor,
      expiresAt: this.clock() + 45_000,
    });
  }
  release(roomHash: string, actor: string, leaseId: string): void {
    this.requireRoom(roomHash).leases.delete(
      `${actor.toLowerCase()}:${leaseId}`,
    );
  }
  save(roomHash: string, archive: ArchiveHead, actor: string): void {
    const room = this.requireRoom(roomHash);
    if (
      archive.author.toLowerCase() !== actor.toLowerCase() ||
      archive.savedAt > this.clock() + 5_000 ||
      archive.savedAt <= 0
    )
      throw new Error("Invalid archive metadata");
    if (!room.archives.some((a) => a.id === archive.id))
      room.archives.push(structuredClone(archive));
    room.archives.sort(
      (a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id),
    );
  }
  metadata(roomHash: string): RoomMetadata {
    const state = this.requireRoom(roomHash);
    const now = this.clock();
    for (const [key, lease] of state.leases)
      if (lease.expiresAt <= now) state.leases.delete(key);
    const activePeerCount = state.leases.size;
    const latest = state.archives[0];
    return {
      room: structuredClone(state.room),
      archives: structuredClone(state.archives),
      lastSavedTimestamp: latest?.savedAt ?? null,
      storageUri: latest?.uri ?? null,
      activePeerCount,
      status: activePeerCount ? "active" : latest ? "hibernating" : "empty",
    };
  }
}
