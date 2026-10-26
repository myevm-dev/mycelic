import { NavigationLink } from "@/components/ui/NavigationLink";
import { Icon } from "./Icon";
export function SiteFooter() {
  return (
    <footer className="site-footer shell">
      <NavigationLink href="/" className="footer-brand">
        <Icon name="nodes" />
        Mycelic Chat
      </NavigationLink>
      <nav className="footer-links" aria-label="Footer">
        <NavigationLink href="/docs">Get started</NavigationLink>
        <NavigationLink href="/docs#agents">Agent guide</NavigationLink>
        <NavigationLink href="/llms.txt">llms.txt</NavigationLink>
        <a href="https://github.com/myevm-dev/mycelic" rel="noreferrer">
          GitHub
        </a>
      </nav>
    </footer>
  );
}
