import { NavigationLink } from "./ui/NavigationLink";
import { Icon } from "./ui/Icon";
import { NetworkArt, GamePreview } from "./ui/NetworkArt";
import { LegacyRoomLink } from "./LegacyRoomLink";
export function HomePage() {
  return (
    <main className="shell network-home" id="main-content" tabIndex={-1}>
      <LegacyRoomLink />
      <section className="network-card" aria-labelledby="home-title">
        <div className="network-copy">
          <div className="section-topline">
            <span className="eyebrow">MYCELIC</span>
            <span className="pill">Chat · Arc testnet</span>
          </div>
          <h1 id="home-title">
            Your people.
            <br />
            Your room.
          </h1>
          <p className="network-lede">
            Private conversations now. Games and voice calls next.
          </p>
          <div className="network-features">
            <div>
              <Icon name="chat" />
              <div>
                <h2>Direct conversations</h2>
                <p>Share a private link and connect with your peers.</p>
              </div>
            </div>
            <div>
              <Icon name="lock" />
              <div>
                <h2>Ephemeral rooms</h2>
                <p>Live messages, held in connected participants’ memory.</p>
              </div>
            </div>
          </div>
          <div className="hero-actions">
            <NavigationLink className="button primary" href="/chat">
              Open Mycelic Chat
              <Icon name="arrow" />
            </NavigationLink>
            <NavigationLink className="text-link" href="/games">
              Games coming soon
              <Icon name="arrow" />
            </NavigationLink>
          </div>
        </div>
        <NetworkArt />
      </section>
      <section className="project-grid" id="projects" aria-label="Mycelic apps">
        <article className="project-card">
          <div className="project-title">
            <span className="icon-tile">
              <Icon name="chat" />
            </span>
            <h2>Mycelic Chat</h2>
            <span className="pill">Open Chat</span>
          </div>
          <div className="project-content">
            <div>
              <p>
                Private rooms. Direct connections.
                <br />
                Ephemeral rooms.
              </p>
              <NavigationLink href="/chat" className="text-link">
                Explore Chat
                <Icon name="arrow" />
              </NavigationLink>
            </div>
            <div className="chat-preview" aria-hidden="true">
              <span className="preview-person first-person" />
              <span className="preview-message first-bubble">
                Meet in the room?
              </span>
              <span className="preview-message second-bubble">Connected.</span>
              <span className="preview-person second-person" />
              <span className="preview-caption">
                <Icon name="lock" />
                Private connection
              </span>
            </div>
          </div>
        </article>
        <article className="project-card">
          <div className="project-title">
            <span className="icon-tile">
              <Icon name="game" />
            </span>
            <h2>Mycelic Games</h2>
            <span className="pill">Coming soon</span>
          </div>
          <div className="project-content">
            <div>
              <p>
                Small multiplayer games.
                <br />
                Shared rooms and friendly competition.
              </p>
              <NavigationLink href="/games" className="text-link">
                Explore Games
                <Icon name="arrow" />
              </NavigationLink>
            </div>
            <GamePreview />
          </div>
        </article>
        <article className="project-card voice-project-card">
          <div className="project-title">
            <span className="icon-tile">
              <Icon name="voice" />
            </span>
            <h2>Mycelic Voice</h2>
            <span className="pill">Coming soon</span>
          </div>
          <div className="project-content">
            <div>
              <p>
                Temporary voice rooms.
                <br />
                Connect, talk, and leave.
              </p>
              <NavigationLink href="/voice" className="text-link">
                Explore Voice
                <Icon name="arrow" />
              </NavigationLink>
            </div>
            <div className="voice-preview" aria-hidden="true">
              <Icon name="voice" width={64} height={64} />
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
          </div>
        </article>
      </section>
    </main>
  );
}
