import type { CSSProperties } from "react";
import { Icon } from "./Icon";
const points = Array.from({ length: 92 }, (_, i) => ({
  x: 22 + ((i * 193 + i * i * 17) % 640),
  y: 20 + ((i * 131 + i * i * 7) % 420),
}));
const edges = points.flatMap((p, i) =>
  points
    .map((q, j) => ({ j, distance: Math.hypot(p.x - q.x, p.y - q.y) }))
    .filter((q) => q.j > i && q.distance < 104)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map(({ j }) => ({ p, q: points[j], id: `${i}-${j}` })),
);
export function NodeField({ backdrop = false }: { backdrop?: boolean }) {
  return (
    <svg
      className={backdrop ? "node-field ambient-field" : "node-field"}
      viewBox="0 0 680 460"
      fill="none"
      aria-hidden="true"
    >
      <g className="network-lines">
        {edges.map(({ p, q, id }) => (
          <path
            key={id}
            d={`M${p.x} ${p.y}Q${(p.x + q.x) / 2 + 12} ${(p.y + q.y) / 2 - 8} ${q.x} ${q.y}`}
          />
        ))}
      </g>
      <g>
        {points.map((p, i) => (
          <g
            key={i}
            className="network-point"
            style={{ "--delay": `${-(i % 11)}s` } as CSSProperties}
          >
            <circle
              className="node-glow"
              cx={p.x}
              cy={p.y}
              r={i % 7 === 0 ? 12 : 7}
            />
            <circle
              className="node-core"
              cx={p.x}
              cy={p.y}
              r={i % 7 === 0 ? 3.5 : 1.9}
            />
          </g>
        ))}
      </g>
    </svg>
  );
}
export function NetworkArt() {
  return (
    <div
      className="network-art"
      role="img"
      aria-label="Decorative illustration of chat and upcoming games"
    >
      <NodeField />
      <span className="art-label user-label">YOUR PEOPLE</span>
      <div className="room-hub chat-hub">
        <Icon name="chat" />
      </div>
      <div className="room-hub game-hub">
        <Icon name="game" />
      </div>
      <span className="art-label manifest-label">YOUR ROOM</span>
      <span className="art-caption">
        Secure <span>·</span> WebRTC Chat
      </span>
    </div>
  );
}
export function GamePreview() {
  return (
    <div className="game-preview" aria-hidden="true">
      <div className="game-board">
        <div />
        <div />
        <div />
        <div />
        <div />
        <div />
        <div />
        <div />
        <div />
      </div>
      {["green", "blue", "amber", "purple"].map((color, i) => (
        <div
          key={color}
          className={`player-node player-${i}`}
          style={{ "--player": `var(--player-${color})` } as CSSProperties}
        >
          <span />
        </div>
      ))}
      <span className="preview-caption">
        <Icon name="layers" />
        Game preview
      </span>
    </div>
  );
}
