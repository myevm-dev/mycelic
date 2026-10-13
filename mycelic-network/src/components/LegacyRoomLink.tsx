"use client";
import { useEffect } from "react";
export function LegacyRoomLink() {
  useEffect(() => {
    if (new URLSearchParams(window.location.hash.slice(1)).has("room"))
      window.location.replace(`/chat${window.location.hash}`);
  }, []);
  return null;
}
