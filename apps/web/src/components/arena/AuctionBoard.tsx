import React from "react";

export function AuctionBoard({ meta, aName, bName }: { meta: any; aName: string; bName: string }) {
  // resolved → auction, live → auction_preview
  const auction = meta?.auction;
  const preview = meta?.auction_preview;
  const data = auction ?? preview ?? null;
  if (!data) return null;

  const item = String(data.item ?? "").trim();
  const vibe = String(data.vibe ?? "").trim();
  const rule = String(data.rule ?? "").trim();
  const isClose = Boolean(auction?.close);
  const hasResults = !!auction?.a;

  return (
    <div className="gameBoard auctionBoard">
      <h3 className="gameBoardTitle">
        경매전
        {isClose ? <span className="badge" style={{ marginLeft: 8 }}>박빙</span> : null}
      </h3>

      {/* 경매품 */}
      <div className="auctionItem">
        <div className="auctionItemName">{item || "경매품"}</div>
        {vibe ? <span className="badge">vibe: {vibe}</span> : null}
      </div>

      {rule ? <div className="auctionRule">규칙: {rule}</div> : null}

      {/* 양측 입찰 비교 — resolved만 */}
      {hasResults ? (() => {
        const aBid = auction.a?.bid;
        const bBid = auction.b?.bid;
        const aTime = Number(auction.a?.time_ms ?? 0) || 0;
        const bTime = Number(auction.b?.time_ms ?? 0) || 0;
        const maxBid = Math.max(Number(aBid ?? 0) || 0, Number(bBid ?? 0) || 0, 1);
        return (
          <>
            <div className="gameBoardColumns">
              {[
                { name: aName, bid: aBid, time: aTime, side: auction.a, label: "A" },
                { name: bName, bid: bBid, time: bTime, side: auction.b, label: "B" },
              ].map(({ name, bid, time, side, label }) => {
                const posture = String(side?.posture ?? "").trim();
                const line = String(side?.line ?? "").trim();
                const bidNum = Number(bid ?? 0) || 0;
                const pct = Math.max(0, Math.min(100, (bidNum / maxBid) * 100));
                return (
                  <div key={label} className="gameBoardColumn">
                    <div className="gameBoardColumnHeader">
                      <span className="gameBoardSide">{name}</span>
                    </div>

                    <div className="auctionBidBar">
                      <div className="auctionBidFill" style={{ width: `${pct}%` }} />
                      <span className="auctionBidAmount">{String(bid ?? "?")}</span>
                    </div>

                    <div className="auctionMeta">
                      <span className="badge">{time}ms</span>
                      {posture ? <span className="badge">{posture}</span> : null}
                    </div>

                    {line ? <div className="auctionLine">{line}</div> : null}
                  </div>
                );
              })}
            </div>

            {auction.result ? (
              <div className="auctionResult">
                결과: 낙찰 {String(auction.result.winner_bid ?? "?")} / 패배 {String(auction.result.loser_bid ?? "?")}
              </div>
            ) : null}
          </>
        );
      })() : (
        <div className="gameBoardPending">입찰 진행 중...</div>
      )}
    </div>
  );
}
