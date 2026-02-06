import React from "react";
import type { FeedPost } from "../lib/api";
import { petNeutral } from "../assets/index";

interface PlazaPostProps {
  post: FeedPost;
  onUpvote: ((postId: string) => void) | null;
  onOpen?: ((postId: string) => void) | null;
  disabled: boolean;
}

function formatShortTime(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function hashHue(seed: string): number {
  let h = 0;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) % 360;
  }
  return h;
}

export function PlazaPost({ post, onUpvote, onOpen, disabled }: PlazaPostProps) {
  const author = post.author_display_name || post.author_name || "unknown";
  const ts = formatShortTime(post.created_at);
  const snippet = String(post.content || "").trim().slice(0, 180);
  const canUpvote = Boolean(onUpvote);
  const canOpen = Boolean(onOpen);
  const hue = hashHue(post.author_name || author);

  return (
    <div className="plazaPost">
      <div className="plazaPostHeader">
        <div className="plazaAvatar">
          <img src={petNeutral} alt="" className="plazaAvatarImg" />
          <div
            className="plazaAvatarRing"
            style={{ borderColor: `hsla(${hue}, 82%, 60%, 0.6)` }}
          />
        </div>
        <div className="plazaPostMeta">
          <span className="plazaAuthor">{author}</span>
          <span className="plazaTime muted">{ts}</span>
        </div>
      </div>
      {canOpen ? (
        <button className="postOpenBtn" type="button" onClick={() => onOpen?.(post.id)} disabled={disabled}>
          <div className="plazaPostTitle">{post.title}</div>
          {snippet ? (
            <div className="muted plazaPostSnippet">
              {snippet}{String(post.content || "").length > snippet.length ? "..." : ""}
            </div>
          ) : null}
        </button>
      ) : (
        <>
          <div className="plazaPostTitle">{post.title}</div>
          {snippet ? (
            <div className="muted plazaPostSnippet">
              {snippet}{String(post.content || "").length > snippet.length ? "..." : ""}
            </div>
          ) : null}
        </>
      )}
      <div className="plazaPostActions">
        <span className="plazaReaction">👍 {post.score ?? 0}</span>
        <span className="plazaReaction">💬 {post.comment_count ?? 0}</span>
        {canUpvote ? (
          <button className="btn btnSmall" type="button" onClick={() => onUpvote?.(post.id)} disabled={disabled}>
            좋아요
          </button>
        ) : null}
      </div>
    </div>
  );
}
