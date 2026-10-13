import {
  roomProtocolSchema,
  type RoomDefinition,
  type Capability,
  type RoomProtocol,
} from "./types";
// Historical v1 wire IDs, preserved so signed room definitions remain valid after rebranding.
// Public SDK and product names use Mycelic; change wire IDs only through a versioned migration.
export const MODULE_IDS = {
  chat: "ember.chat",
} as const;
export const chatProtocol = (paid = false): RoomProtocol => ({
  version: 1,
  modules: [{ id: MODULE_IDS.chat, version: paid ? 3 : 2, required: true }],
});
export const resolveRoomProtocol = (room: RoomDefinition): RoomProtocol =>
  room.protocol
    ? roomProtocolSchema.parse(room.protocol)
    : {
        version: 1,
        modules: [{ id: MODULE_IDS.chat, version: 1, required: true }],
      };
/** Missing optional modules are allowed. Required modules must be supported at exactly the signed version. */
export const assertCapabilities = (
  required: RoomProtocol,
  available: readonly Pick<Capability, "id" | "version">[],
): void => {
  for (const capability of required.modules) {
    if (
      capability.required &&
      !available.some(
        (m) => m.id === capability.id && m.version === capability.version,
      )
    )
      throw new Error(
        `Required module unavailable: ${capability.id}@${capability.version}`,
      );
  }
};
