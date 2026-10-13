import type { Metadata } from "next";
import { NavigationLink } from "@/components/ui/NavigationLink";
import { Icon } from "@/components/ui/Icon";
export const metadata: Metadata = { title: "Mycelic Voice" };
export default function VoicePage() {
  return (
    <main className="shell product-page" id="main-content" tabIndex={-1}>
      <section className="product-hero card">
        <div>
          <div className="section-topline">
            <span className="eyebrow">MYCELIC VOICE</span>
            <span className="pill">Coming soon</span>
          </div>
          <h1>
            A room to talk.
            <br />
            <span className="accent-text">Just for now.</span>
          </h1>
          <p className="page-lede">
            Temporary voice channels for friends, teams, and game nights.
          </p>
          <p>
            Voice calls are planned. Room access, payment controls, connection
            limits, and privacy behavior will be defined before launch. No voice
            calling is available yet.
          </p>
          <div className="hero-actions">
            <NavigationLink href="/chat" className="button primary">
              Open Mycelic Chat
              <Icon name="arrow" />
            </NavigationLink>
          </div>
        </div>
        <div className="voice-preview large-voice-preview" aria-hidden="true">
          <Icon name="voice" width={100} height={100} />
          <div className="voice-wave">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      </section>
    </main>
  );
}
