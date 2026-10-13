"use client";
/** Focus content without replacing a chat URL's secret-bearing fragment. */
export function SkipLink() {
  return (
    <a
      className="skip-link"
      href="#main-content"
      onClick={(event) => {
        const main = document.getElementById("main-content");
        if (!main) return;
        event.preventDefault();
        main.focus({ preventScroll: true });
        main.scrollIntoView({ block: "start", behavior: "instant" });
      }}
    >
      Skip to content
    </a>
  );
}
