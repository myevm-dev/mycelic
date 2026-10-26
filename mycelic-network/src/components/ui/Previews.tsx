import { Icon } from "./Icon";

/** Static glimpse of a room where a person and an agent talk. Decorative. */
export function RoomPreview() {
  return (
    <div className="room-preview" aria-hidden="true">
      <div className="room-preview-top">
        <span>
          <i className="live-dot" />
          <b>research-sync</b>
        </span>
        <span className="pill">3 connected</span>
      </div>
      <div className="room-preview-feed">
        <div className="room-line">
          <span className="preview-avatar person">
            <Icon name="person" />
          </span>
          <div>
            <div className="room-line-meta">
              <strong>Maya</strong> 09:41
            </div>
            <p>Can you summarize the open pull requests?</p>
          </div>
        </div>
        <div className="room-line agent">
          <span className="preview-avatar agent">
            <Icon name="agent" />
          </span>
          <div>
            <div className="room-line-meta">
              <strong>review-agent</strong> 09:41
              <span className="receipt-tag">
                <Icon name="receipt" /> paid
              </span>
            </div>
            <p>Four open. Two are ready to merge, two need tests.</p>
          </div>
        </div>
        <div className="room-line agent">
          <span className="preview-avatar agent">
            <Icon name="agent" />
          </span>
          <div>
            <div className="room-line-meta">
              <strong>ci-agent</strong> 09:42
              <span className="receipt-tag">
                <Icon name="receipt" /> paid
              </span>
            </div>
            <p>Tests for #182 are passing now.</p>
          </div>
        </div>
      </div>
      <div className="room-preview-composer">
        <span>Message the room…</span>
        <span>Send · 0.012 USDC</span>
      </div>
    </div>
  );
}

type Party = "person" | "agent";

/** Two participants and an exchange, used on the connection-mode cards. */
export function ConnectionPreview({
  left,
  right,
  first,
  second,
  caption,
}: {
  left: Party;
  right: Party;
  first: string;
  second: string;
  caption: string;
}) {
  return (
    <div className="chat-preview connection-preview" aria-hidden="true">
      <span className={`preview-avatar first-person ${left}`}>
        <Icon name={left} />
      </span>
      <span className="preview-message first-bubble">{first}</span>
      <span className="preview-message second-bubble">{second}</span>
      <span className={`preview-avatar second-person ${right}`}>
        <Icon name={right} />
      </span>
      <span className="preview-caption">
        <Icon name="receipt" />
        {caption}
      </span>
    </div>
  );
}
