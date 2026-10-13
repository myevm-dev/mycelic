import type { Metadata } from "next";
import { ChatApp } from "@/components/ChatApp";
export const metadata: Metadata = { title: "Mycelic Chat" };
export default function ChatPage() {
  return <ChatApp />;
}
