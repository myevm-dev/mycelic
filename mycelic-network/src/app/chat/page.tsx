import type { Metadata } from "next";
import { ChatApp } from "@/components/ChatApp";
export const metadata: Metadata = { title: "Rooms" };
export default function ChatPage() {
  return <ChatApp />;
}
