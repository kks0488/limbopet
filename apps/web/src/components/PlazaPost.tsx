
import type { FeedPost } from "../lib/api";
import { parseArenaRecap } from "../lib/arenaRecapParser";

interface PlazaPostProps {
  post: FeedPost;
  onUpvote: ((postId: string) => void) | null;
  onOpen?: ((postId: string) => void) | null;
  disabled: boolean;
}

/* ── Helpers ── */

function relativeTime(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;
  if (diff < MIN) return "방금";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}분 전`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}일 전`;
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

const TYPE_ICON: Record<string, string> = {
  arena: "⚔️",
  plaza: "💬",
  diary: "📔",
};

/** Generate a readable title for arena posts when post.title is missing / generic */
function deriveArenaTitle(post: FeedPost): string {
  const raw = (post.title || "").trim();
  if (raw.length > 2 && !/^arena$/i.test(raw)) return raw;
  const parsed = parseArenaRecap(String(post.content || ""));
  if (!parsed) return raw || "아레나 매치";
  const a = parsed.participantA || "???";
  const b = parsed.participantB || "???";
  if (parsed.mode === "COURT_TRIAL") return `모의재판: ${a} vs ${b}`;
  if (parsed.mode === "DEBATE_CLASH") return `설전: ${a} vs ${b}`;
  return `${a} vs ${b}`;
}

/* ── Main export ── */

export function PlazaPost({ post, onUpvote, onOpen, disabled }: PlazaPostProps) {
  const author = post.author_display_name || post.author_name || "unknown";
  const timeAgo = relativeTime(post.created_at);
  const canOpen = Boolean(onOpen);
  const isArena = post.post_type === "arena";

  const icon = TYPE_ICON[post.post_type] || "💬";
  const title = isArena ? deriveArenaTitle(post) : (post.title || String(post.content || "").trim().slice(0, 60));

  const inner = (
    <>
      <div className="fp-row-main">
        <span className="fp-row-icon">{icon}</span>
        <div className="fp-row-content">
          <div className="fp-row-top">
            <span className="fp-row-title">{title}</span>
            <span className="fp-row-stats">
              {(post.score ?? 0) > 0 ? `${post.score} 좋아요` : ""}
              {(post.score ?? 0) > 0 && (post.comment_count ?? 0) > 0 ? " · " : ""}
              {(post.comment_count ?? 0) > 0 ? `${post.comment_count} 댓글` : ""}
            </span>
          </div>
          <div className="fp-row-bottom">
            <span className="fp-row-author">{author}</span>
            <span className="fp-row-sep">·</span>
            <span className="fp-row-time">{timeAgo}</span>
          </div>
        </div>
      </div>
    </>
  );

  if (canOpen) {
    return (
      <button className={`fp-row${isArena ? " fp-row--arena" : ""}`} type="button" onClick={() => onOpen?.(post.id)} disabled={disabled}>
        {inner}
      </button>
    );
  }

  return (
    <div className={`fp-row${isArena ? " fp-row--arena" : ""}`}>
      {inner}
    </div>
  );
}
