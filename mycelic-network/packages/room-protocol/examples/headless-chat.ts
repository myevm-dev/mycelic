import { RoomSession, type RoomSessionOptions } from "../src/index";
import { ChatModule, type ChatModuleOptions } from "../src/chat";
/** Reuse authenticated chat in another application with no React or Next.js components. */
export const joinHeadlessChat = async (
  options: RoomSessionOptions,
  chatOptions: Omit<ChatModuleOptions, "room" | "authorize">,
) => {
  const chat = new ChatModule({
    ...chatOptions,
    room: options.room,
    authorize: options.authorize,
  });
  const session = new RoomSession(options).install(chat);
  await session.start();
  return { session, chat };
};
