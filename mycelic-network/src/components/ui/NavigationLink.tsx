import type { AnchorHTMLAttributes } from "react";
/** Use document navigation so an active chat's native beforeunload protection runs.
 * Theme preference is persisted independently; changing theme never navigates. */
export function NavigationLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
