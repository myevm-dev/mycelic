import type { Metadata } from "next";
import { NavigationLink } from "@/components/ui/NavigationLink";
import { GamePreview } from "@/components/ui/NetworkArt";
import { Icon } from "@/components/ui/Icon";
export const metadata: Metadata = { title: "Mycelic Games" };
export default function GamesPage() {
  return (
    <main className="shell product-page" id="main-content" tabIndex={-1}>
      <section className="product-hero card">
        <div>
          <div className="section-topline">
            <span className="eyebrow">MYCELIC GAMES</span>
            <span className="pill">Coming soon</span>
          </div>
          <h1>
            Play together.
            <br />
            <span className="accent-text">One room at a time.</span>
          </h1>
          <p className="page-lede">
            Small multiplayer games, shared rooms and friendly competition.
          </p>
          <p>
            We are starting with chat. Games will follow with a first turn-based
            game, clear room limits and reconnectable matches.
          </p>
          <div className="hero-actions">
            <NavigationLink href="/chat" className="button primary">
              Try Mycelic Chat
              <Icon name="arrow" />
            </NavigationLink>
            <NavigationLink href="/" className="text-link">
              Back to Mycelic
              <Icon name="arrow" />
            </NavigationLink>
          </div>
        </div>
        <div className="large-game-preview">
          <GamePreview />
        </div>
      </section>
      <div className="page-note">
        <Icon name="game" />
        <p>
          The game preview is decorative. No playable game or game hosting is
          available yet.
        </p>
      </div>
    </main>
  );
}
