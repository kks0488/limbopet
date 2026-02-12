import { useEffect, useRef, useState } from "react";
import { plazaBoard, type FeedPost, type PlazaBoardKind } from "../lib/api";
import { friendlyError } from "../lib/errorMessages";
import { PlazaPost } from "./PlazaPost";

type Toast = { kind: "good" | "warn" | "bad"; text: string } | null;

interface PlazaTabProps {
  token: string;
  pet: any;
  busy: boolean;
  onCreatePost: () => void;
  onUpvote: ((postId: string) => void) | null;
  onOpenPost: (postId: string) => void;
  onOpenMatch: (matchId: string) => void;
  onSetActiveTab: (tab: string) => void;
  onSetToast: (t: Toast) => void;
}

const KIND_OPTIONS: Array<{ value: PlazaBoardKind; label: string }> = [
  { value: "all", label: "\uC804\uCCB4" },
  { value: "plaza", label: "\uC790\uC720" },
  { value: "arena", label: "\uC544\uB808\uB098" },
];

export function PlazaTab({
  token,
  pet,
  busy,
  onCreatePost,
  onUpvote,
  onOpenPost,
  onSetActiveTab,
  onSetToast,
}: PlazaTabProps) {
  const [plazaKind, setPlazaKind] = useState<PlazaBoardKind>("all");
  const [plazaQueryDraft, setPlazaQueryDraft] = useState<string>("");
  const [plazaQuery, setPlazaQuery] = useState<string>("");
  const [plazaPosts, setPlazaPosts] = useState<FeedPost[]>([]);
  const [plazaPage, setPlazaPage] = useState<number>(1);
  const [plazaPagination, setPlazaPagination] = useState<{ limit: number; total: number; pageCount: number }>({
    limit: 25,
    total: 0,
    pageCount: 1,
  });
  const [plazaLoading, setPlazaLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  const plazaLoadSeqRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const clearToastLater = () => {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = window.setTimeout(() => {
      onSetToast(null);
      toastTimeoutRef.current = null;
    }, 3200);
  };

  async function loadPlaza({ page }: { page: number }) {
    const limit = 25;
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const seq = plazaLoadSeqRef.current + 1;
    plazaLoadSeqRef.current = seq;

    setPlazaLoading(true);
    try {
      const res = await plazaBoard(token, {
        sort: "new",
        kind: plazaKind,
        q: plazaQuery,
        limit,
        page: safePage,
        withTotal: true,
      });
      if (plazaLoadSeqRef.current !== seq) return;

      setPlazaPosts(res.posts || []);

      const nextLimit = Number(res.pagination?.limit ?? limit) || limit;
      const nextTotal = Number(res.pagination?.total ?? 0) || 0;
      const nextPageCountRaw = Number(res.pagination?.pageCount ?? 1) || 1;
      const nextPageCount = nextPageCountRaw > 0 ? nextPageCountRaw : 1;

      setPlazaPagination({
        limit: nextLimit,
        total: nextTotal,
        pageCount: nextPageCount,
      });
    } catch (e: any) {
      if (plazaLoadSeqRef.current !== seq) return;
      onSetToast({ kind: "bad", text: friendlyError(e) });
      clearToastLater();
    } finally {
      if (plazaLoadSeqRef.current === seq) setPlazaLoading(false);
    }
  }

  function handleSearch() {
    const next = plazaQueryDraft.trim();
    if (next === plazaQuery) {
      if (plazaPage !== 1) setPlazaPage(1);
      else void loadPlaza({ page: 1 });
    } else {
      setPlazaQuery(next);
      setPlazaPage(1);
    }
  }

  function handleClearSearch() {
    setPlazaQueryDraft("");
    if (plazaQuery === "") {
      if (plazaPage !== 1) setPlazaPage(1);
      else void loadPlaza({ page: 1 });
    } else {
      setPlazaQuery("");
      setPlazaPage(1);
    }
  }

  // Load plaza board on mount / filter change
  useEffect(() => {
    void loadPlaza({ page: plazaPage });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, plazaKind, plazaQuery, plazaPage]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <div className="feed-container">

      {/* ---- Spectator CTA (no pet) ---- */}
      {!pet ? (
        <div className="feed-spectator-cta">
          <div className="feed-spectator-cta__icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </div>
          <div>
            <div className="feed-spectator-cta__title">{"\uAD00\uC804 \uBAA8\uB4DC"}</div>
            <div className="feed-spectator-cta__desc">
              {"\uC9C0\uAE08\uC740 \uAD6C\uACBD\uB9CC \uAC00\uB2A5\uD574\uC694. \uD3AB\uC744 \uB9CC\uB4E4\uBA74 \uC88B\uC544\uC694/\uB313\uAE00 \uAC19\uC740 \uC0C1\uD638\uC791\uC6A9\uC774 \uC5F4\uB824\uC694."}
            </div>
          </div>
          <button
            className="feed-spectator-cta__btn"
            type="button"
            onClick={() => onSetActiveTab("pet")}
            disabled={busy}
          >
            {"\uD3AB \uB9CC\uB4E4\uAE30"}
          </button>
        </div>
      ) : null}

      {/* ---- Filter Bar (segment + write button) ---- */}
      <div className="feed-filters">
        <div className="feed-filters__row">
          {/* Kind pills (segmented control) */}
          <div className="feed-segment">
            {KIND_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`feed-segment__btn${plazaKind === opt.value ? " feed-segment__btn--active" : ""}`}
                type="button"
                onClick={() => { setPlazaKind(opt.value); setPlazaPage(1); }}
                disabled={busy || plazaLoading}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Write button - compact, next to segment */}
          {pet ? (
            <button
              className="feed-write-btn"
              type="button"
              onClick={() => onCreatePost()}
              disabled={busy || plazaLoading}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* ---- Search Bar ---- */}
      <div className={`feed-search${searchFocused ? " feed-search--focused" : ""}`}>
        <div className="feed-search__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <input
          ref={searchInputRef}
          className="feed-search__input"
          value={plazaQueryDraft}
          onChange={(e) => setPlazaQueryDraft(e.target.value)}
          placeholder={"\uAC80\uC0C9..."}
          onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          disabled={busy || plazaLoading}
          aria-label={"\uAC80\uC0C9"}
        />
        {plazaQueryDraft ? (
          <button
            className="feed-search__clear"
            type="button"
            onClick={handleClearSearch}
            disabled={busy || plazaLoading}
            aria-label={"\uAC80\uC0C9 \uCD08\uAE30\uD654"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* ---- Loading indicator ---- */}
      {plazaLoading ? (
        <div className="feed-loading">
          <div className="feed-loading__bar" />
        </div>
      ) : null}

      {/* ---- Posts Feed ---- */}
      {plazaPosts.length === 0 && !plazaLoading ? (
        <div className="feed-empty">
          <div className="feed-empty__icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="feed-empty__text">{"\uC544\uC9C1 \uC544\uBB34\uB3C4 \uAE00\uC744 \uC548 \uC37C\uC5B4\uC694."}</div>
          <div className="feed-empty__sub">{"\uCCAB \uAE00\uC758 \uC8FC\uC778\uACF5\uC774 \uB3FC \uBD10\uC694!"}</div>
        </div>
      ) : (
        <div className="feed-list">
          {plazaPosts.map((p) => (
            <PlazaPost
              key={p.id}
              post={p}
              onUpvote={onUpvote}
              onOpen={(postId) => onOpenPost(postId)}
              disabled={busy || plazaLoading}
            />
          ))}
        </div>
      )}

      {/* ---- Pagination ---- */}
      {plazaPagination.pageCount > 1 ? (
        <div className="feed-pager">
          <button
            className="feed-pager__btn"
            type="button"
            onClick={() => setPlazaPage((p) => Math.max(1, p - 1))}
            disabled={busy || plazaLoading || plazaPage <= 1}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>

          <div className="feed-pager__pages">
            {(() => {
              const nodes: React.ReactNode[] = [];
              const totalPages = Math.max(1, plazaPagination.pageCount);
              const current = Math.max(1, Math.min(totalPages, plazaPage));
              const windowSize = 2;

              const pushPage = (n: number) => {
                nodes.push(
                  <button
                    key={`p-${n}`}
                    className={`feed-pager__page${n === current ? " feed-pager__page--active" : ""}`}
                    type="button"
                    onClick={() => setPlazaPage(n)}
                    disabled={busy || plazaLoading || n === current}
                  >
                    {n}
                  </button>,
                );
              };

              const pushDots = (key: string) => {
                nodes.push(
                  <span key={key} className="feed-pager__dots">
                    ...
                  </span>,
                );
              };

              const start = Math.max(1, current - windowSize);
              const end = Math.min(totalPages, current + windowSize);

              if (start > 1) {
                pushPage(1);
                if (start > 2) pushDots("d1");
              }
              for (let n = start; n <= end; n += 1) pushPage(n);
              if (end < totalPages) {
                if (end < totalPages - 1) pushDots("d2");
                pushPage(totalPages);
              }

              return nodes;
            })()}
          </div>

          <button
            className="feed-pager__btn"
            type="button"
            onClick={() => setPlazaPage((p) => Math.min(plazaPagination.pageCount, p + 1))}
            disabled={busy || plazaLoading || plazaPage >= plazaPagination.pageCount}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      ) : null}

    </div>
  );
}
