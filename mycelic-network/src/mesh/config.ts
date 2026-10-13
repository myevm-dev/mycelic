/** Shared browser connection settings for human and agent transports. */
export function meshNetworkOptions(): {
  relayUrls?: string[];
  rtcConfig?: RTCConfiguration;
} {
  return {
    ...(process.env.NEXT_PUBLIC_NOSTR_RELAY_URL
      ? {
          relayUrls: process.env.NEXT_PUBLIC_NOSTR_RELAY_URL.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
    ...(process.env.NEXT_PUBLIC_TURN_URL || process.env.NEXT_PUBLIC_STUN_URL
      ? {
          rtcConfig: {
            iceServers: [
              {
                urls:
                  process.env.NEXT_PUBLIC_STUN_URL ||
                  "stun:stun.l.google.com:19302",
              },
              ...(process.env.NEXT_PUBLIC_TURN_URL
                ? [
                    {
                      urls: process.env.NEXT_PUBLIC_TURN_URL,
                      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
                      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
                    },
                  ]
                : []),
            ],
          },
        }
      : {}),
  };
}
