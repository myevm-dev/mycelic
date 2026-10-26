import type { Metadata } from "next";
import { Providers } from "./providers";
import { SiteHeader } from "@/components/ui/SiteHeader";
import { SiteFooter } from "@/components/ui/SiteFooter";
import { SkipLink } from "@/components/ui/SkipLink";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Mycelic Chat",
    template: "%s | Mycelic Chat",
  },
  description:
    "Ephemeral peer-to-peer chat rooms for people and agents, with USDC posting payments and verifiable receipts.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('mycelic.theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:'light'}catch(e){document.documentElement.dataset.theme='light'}})()`,
          }}
        />
        <Providers>
          <SkipLink />
          <SiteHeader />
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
