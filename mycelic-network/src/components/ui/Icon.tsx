import type { SVGProps } from "react";
export type IconName =
  | "nodes"
  | "chat"
  | "game"
  | "voice"
  | "layers"
  | "storage"
  | "lock"
  | "wallet"
  | "sun"
  | "moon"
  | "arrow"
  | "code";
export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    nodes: (
      <>
        <path d="m12 5-3 5 6 4-4 5M9 10l-5 3m11 1 5-3" />
        <circle cx="12" cy="3" r="2" />
        <circle cx="9" cy="10" r="2" />
        <circle cx="2" cy="14" r="2" />
        <circle cx="15" cy="14" r="2" />
        <circle cx="21" cy="10" r="2" />
        <circle cx="10" cy="21" r="2" />
      </>
    ),
    chat: (
      <>
        <path d="M21 11a9 9 0 0 1-9 9c-1.5 0-3-.4-4.2-1L3 21l1.5-5A9 9 0 1 1 21 11Z" />
        <path d="M8 10h.01M12 10h.01M16 10h.01" />
      </>
    ),
    game: (
      <>
        <path d="M7 7h10c2 0 3 2 3.5 4l1 6c.4 2-1.7 3-3.1 1.5L15 15H9l-3.4 3.5C4.2 20 2.1 19 2.5 17l1-6C4 9 5 7 7 7Z" />
        <path d="M8 9v5m-2.5-2.5h5M16 10h.01M18 13h.01" />
      </>
    ),
    voice: (
      <>
        <rect x="9" y="2" width="6" height="13" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 10 6-10 6L2 9l10-6ZM2 13l10 6 10-6M2 17l10 6 10-6" />
      </>
    ),
    storage: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="12" rx="2" />
        <path d="M8 10V6a4 4 0 0 1 8 0v4M12 15v3" />
      </>
    ),
    wallet: (
      <>
        <path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v11H5a3 3 0 0 1-3-3V6" />
        <path d="M21 12h-6v5h6M17 14.5h.01" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    moon: <path d="M20 15.3A9 9 0 0 1 8.7 4a9 9 0 1 0 11.3 11.3Z" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    code: (
      <>
        <path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
