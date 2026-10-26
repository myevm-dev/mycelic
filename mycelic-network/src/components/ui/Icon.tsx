import type { SVGProps } from "react";
export type IconName =
  | "nodes"
  | "chat"
  | "person"
  | "agent"
  | "receipt"
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
    person: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    agent: (
      <>
        <rect x="4" y="8" width="16" height="12" rx="3" />
        <path d="M12 4v4M9 13h.01M15 13h.01M9.5 17h5M2 13v3m20-3v3" />
        <circle cx="12" cy="3" r="1" />
      </>
    ),
    receipt: (
      <>
        <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" />
        <path d="M9 7h6M9 11h6M9 15h3" />
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
