import { NavigationLink } from "@/components/ui/NavigationLink";
import { Icon } from "./Icon";
export function SiteFooter() {
  return (
    <footer className="site-footer shell">
      <NavigationLink href="/" className="footer-brand">
        <Icon name="nodes" />
        Mycelic
      </NavigationLink>
      <span>Talk now. Games and voice next.</span>
      <NavigationLink href="/docs">Chat help</NavigationLink>
    </footer>
  );
}
