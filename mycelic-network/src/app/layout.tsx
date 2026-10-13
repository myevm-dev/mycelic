import type { Metadata } from "next";
import { Providers } from "./providers";
import { SiteHeader } from "@/components/ui/SiteHeader";
import { SiteFooter } from "@/components/ui/SiteFooter";
import { NodeField } from "@/components/ui/NetworkArt";
import { SkipLink } from "@/components/ui/SkipLink";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Mycelic",
    template: "%s | Mycelic",
  },
  description:
    "Ephemeral peer-to-peer chat with USDC creation and posting payments. Mycelic Games and Voice are coming soon.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('mycelic.theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}})()`,
          }}
        />
        <Providers>
          <SkipLink />
          <div className="network-backdrop">
            <NodeField backdrop />
          </div>
          <SiteHeader />
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
