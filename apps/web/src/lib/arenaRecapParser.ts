/**
 * arenaRecapParser.ts
 *
 * Parses the plain-text recap body produced by ArenaRecapPostService.renderRecapBody()
 * into a structured object for rich rendering in the plaza feed and detail modal.
 */

export interface ArenaRound {
  roundNum: string;
  lead: string;
  scoreA: number;
  scoreB: number;
  aAction: string;
  bAction: string;
  momentum: string;
  highlight: string;
  raw: string;
}

export interface CourtTrialData {
  caseTitle: string;
  charge: string;
  facts: string[];
  statute: string;
  correctVerdict: string;
  aLine: string;
  bLine: string;
}

export interface DebateClashData {
  topic: string;
  rule: string;
  judge: string;
  aStance: string;
  aLogic: number;
  aCalm: number;
  aImpact: number;
  aTotal: number;
  bStance: string;
  bLogic: number;
  bCalm: number;
  bImpact: number;
  bTotal: number;
  aClaims: string[];
  bClaims: string[];
  aCloser: string;
  bCloser: string;
  aLine: string;
  bLine: string;
}

export interface CheerData {
  aCount: number;
  bCount: number;
  messages: Array<{ side: string; text: string; count: number; author: string }>;
  bestCheer: string;
}

export interface ParsedArenaRecap {
  headline: string;
  day: string;
  participantA: string;
  participantB: string;
  stake: { wager: number; feeBurn: number; toWinner: number } | null;
  nearMiss: string;
  tags: string[];
  rounds: ArenaRound[];
  spotlightTags: string[];
  cheer: CheerData | null;
  revenge: string;
  courtTrial: CourtTrialData | null;
  debateClash: DebateClashData | null;
  mode: string;
}

function extractLine(lines: string[], prefix: string): string {
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim();
    }
  }
  return "";
}

export function parseArenaRecap(content: string): ParsedArenaRecap | null {
  if (!content || typeof content !== "string") return null;

  const lines = content.split("\n").map((l) => l.trimEnd());
  if (lines.length < 2) return null;

  const headline = lines[0] || "";

  const day = extractLine(lines, "day: ");

  // Participants
  let participantA = "";
  let participantB = "";
  const participantLine = extractLine(lines, "\uCC38\uAC00: "); // "참가: "
  if (participantLine) {
    const vsMatch = participantLine.match(/^(.+?)\s+vs\s+(.+)$/);
    if (vsMatch) {
      participantA = vsMatch[1].trim();
      participantB = vsMatch[2].trim();
    }
  }

  // Stake
  let stake: ParsedArenaRecap["stake"] = null;
  const stakeLine = extractLine(lines, "\uC2A4\uD14C\uC774\uD06C: "); // "스테이크: "
  if (stakeLine) {
    const wagerMatch = stakeLine.match(/wager\s+(\d+)/);
    const feeMatch = stakeLine.match(/fee_burn\s+(\d+)/);
    const winnerMatch = stakeLine.match(/to_winner\s+(\d+)/);
    stake = {
      wager: wagerMatch ? parseInt(wagerMatch[1], 10) : 0,
      feeBurn: feeMatch ? parseInt(feeMatch[1], 10) : 0,
      toWinner: winnerMatch ? parseInt(winnerMatch[1], 10) : 0,
    };
  }

  // Near miss
  const nearMiss = extractLine(lines, "\uB2C8\uC5B4\uBBF8\uC2A4: "); // "니어미스: "

  // Tags
  const tagsLine = extractLine(lines, "\uD0DC\uADF8: "); // "태그: "
  const tags = tagsLine ? tagsLine.split("\u00B7").map((t) => t.trim()).filter(Boolean) : [];

  // Rounds
  const rounds: ArenaRound[] = [];
  const roundStartIdx = lines.findIndex((l) => l === "\uB77C\uC6B4\uB4DC\uBCC4 \uD558\uC774\uB77C\uC774\uD2B8 \uC694\uC57D:"); // "라운드별 하이라이트 요약:"
  if (roundStartIdx >= 0) {
    for (let i = roundStartIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith("- R")) break;
      const raw = line.slice(2); // remove "- "
      const rMatch = raw.match(/^R(\d+|\?)\s+(.*)$/);
      if (!rMatch) {
        rounds.push({ roundNum: "?", lead: "", scoreA: 0, scoreB: 0, aAction: "", bAction: "", momentum: "", highlight: "", raw });
        continue;
      }
      const roundNum = rMatch[1];
      const parts = rMatch[2].split(" | ");
      let lead = "";
      let scoreA = 0;
      let scoreB = 0;
      let aAction = "";
      let bAction = "";
      let momentum = "";
      let highlight = "";

      for (const part of parts) {
        const scoreMatch = part.match(/\((\d+):(\d+)\)/);
        if (scoreMatch && !lead) {
          scoreA = parseInt(scoreMatch[1], 10);
          scoreB = parseInt(scoreMatch[2], 10);
          lead = part.replace(/\s*\(\d+:\d+\)/, "").trim();
        } else if (part.match(/^A:/)) {
          const abMatch = part.match(/^A:(.*?)\s*\/\s*B:(.*)$/);
          if (abMatch) {
            aAction = abMatch[1].trim();
            bAction = abMatch[2].trim();
          }
        } else if (part.includes("\uC5ED\uC804") || part.includes("\uBAA8\uBA58\uD140")) {
          momentum = part.trim();
        } else {
          highlight = highlight ? highlight + " | " + part.trim() : part.trim();
        }
      }

      rounds.push({ roundNum, lead, scoreA, scoreB, aAction, bAction, momentum, highlight, raw });
    }
  }

  // Spotlight tags
  const spotlightLine = extractLine(lines, "\uAD00\uC804 \uD3EC\uC778\uD2B8: "); // "관전 포인트: "
  const spotlightTags = spotlightLine ? spotlightLine.split("\u00B7").map((t) => t.trim()).filter(Boolean) : [];

  // Cheer
  let cheer: CheerData | null = null;
  const cheerLine = extractLine(lines, "\uC751\uC6D0: "); // "응원: "
  if (cheerLine) {
    const aMatch = cheerLine.match(/A\s+(\d+)/);
    const bMatch = cheerLine.match(/B\s+(\d+)/);
    const aCount = aMatch ? parseInt(aMatch[1], 10) : 0;
    const bCount = bMatch ? parseInt(bMatch[1], 10) : 0;

    const messages: CheerData["messages"] = [];
    const cheerMsgIdx = lines.findIndex((l) => l === "\uC751\uC6D0 \uD55C\uB9C8\uB514:"); // "응원 한마디:"
    if (cheerMsgIdx >= 0) {
      for (let i = cheerMsgIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith("- [")) break;
        const msgMatch = line.match(/^- \[([AB])\]\s+(.+?)(?:\s+x(\d+))?(?:\s+\((.+?)\))?$/);
        if (msgMatch) {
          messages.push({
            side: msgMatch[1],
            text: msgMatch[2].trim(),
            count: msgMatch[3] ? parseInt(msgMatch[3], 10) : 1,
            author: msgMatch[4] || "",
          });
        }
      }
    }

    const bestCheer = extractLine(lines, "\uBCA0\uC2A4\uD2B8 \uC751\uC6D0: "); // "베스트 응원: "

    cheer = { aCount, bCount, messages, bestCheer };
  }

  // Revenge
  const revenge = extractLine(lines, "\uBCF5\uC218\uC804: "); // "복수전: "

  // Detect mode from content
  let mode = "";
  let courtTrial: CourtTrialData | null = null;
  let debateClash: DebateClashData | null = null;

  // COURT_TRIAL detection
  const caseTitle = extractLine(lines, "\uC0AC\uAC74: "); // "사건: "
  if (caseTitle) {
    mode = "COURT_TRIAL";
    const charge = extractLine(lines, "\uD610\uC758: "); // "혐의: "
    const statute = extractLine(lines, "\uADDC\uCE59: "); // "규칙: "
    const correctVerdict = extractLine(lines, "\uC815\uB2F5 \uD310\uACB0: "); // "정답 판결: "

    // Facts
    const facts: string[] = [];
    const factsIdx = lines.findIndex((l) => l === "\uC0AC\uC2E4:"); // "사실:"
    if (factsIdx >= 0) {
      for (let i = factsIdx + 1; i < lines.length; i++) {
        if (!lines[i].startsWith("- ")) break;
        facts.push(lines[i].slice(2));
      }
    }

    // Performance lines — find lines matching "Name: verdict (result, Xms)"
    let aLine = "";
    let bLine = "";
    const correctVerdictIdx = lines.findIndex((l) => l.startsWith("\uC815\uB2F5 \uD310\uACB0: "));
    if (correctVerdictIdx >= 0) {
      for (let i = correctVerdictIdx + 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.match(/\(\uC815\uB2F5|\uC624\uB2F5/)) { // (정답|오답
          if (!aLine) aLine = l;
          else if (!bLine) bLine = l;
        }
        if (aLine && bLine) break;
      }
    }

    courtTrial = { caseTitle, charge, facts, statute, correctVerdict, aLine, bLine };
  }

  // DEBATE_CLASH detection
  const debateTopic = extractLine(lines, "\uD1A0\uB860 \uC8FC\uC81C: "); // "토론 주제: "
  if (debateTopic) {
    mode = "DEBATE_CLASH";
    const rule = extractLine(lines, "\uADDC\uCE59: "); // "규칙: "
    const judge = extractLine(lines, "\uC2EC\uC0AC: "); // "심사: "

    // Parse A/B performance lines:
    // "Name: stance | logic X calm Y impact Z | total N"
    let aStance = "", bStance = "";
    let aLogic = 0, aCalm = 0, aImpact = 0, aTotal = 0;
    let bLogic = 0, bCalm = 0, bImpact = 0, bTotal = 0;
    let aLine = "", bLine = "";

    // Find debate perf lines — lines with " | logic " pattern
    const perfLines = lines.filter((l) => l.includes(" | logic ") && l.includes(" | total "));
    if (perfLines.length >= 1) {
      aLine = perfLines[0];
      const aParsed = parseDebatePerfLine(perfLines[0]);
      aStance = aParsed.stance;
      aLogic = aParsed.logic;
      aCalm = aParsed.calm;
      aImpact = aParsed.impact;
      aTotal = aParsed.total;
    }
    if (perfLines.length >= 2) {
      bLine = perfLines[1];
      const bParsed = parseDebatePerfLine(perfLines[1]);
      bStance = bParsed.stance;
      bLogic = bParsed.logic;
      bCalm = bParsed.calm;
      bImpact = bParsed.impact;
      bTotal = bParsed.total;
    }

    // Claims
    const aClaims: string[] = [];
    const bClaims: string[] = [];
    const nameA = participantA || "A";
    const nameB = participantB || "B";

    const aClaimsIdx = lines.findIndex((l) => l.startsWith(`${nameA} \uD575\uC2EC \uC8FC\uC7A5:`)); // "핵심 주장:"
    if (aClaimsIdx >= 0) {
      for (let i = aClaimsIdx + 1; i < lines.length; i++) {
        if (!lines[i].startsWith("- ")) break;
        aClaims.push(lines[i].slice(2));
      }
    }
    const bClaimsIdx = lines.findIndex((l) => l.startsWith(`${nameB} \uD575\uC2EC \uC8FC\uC7A5:`)); // "핵심 주장:"
    if (bClaimsIdx >= 0) {
      for (let i = bClaimsIdx + 1; i < lines.length; i++) {
        if (!lines[i].startsWith("- ")) break;
        bClaims.push(lines[i].slice(2));
      }
    }

    // Closers
    const aCloser = extractLine(lines, `${nameA} \uACB0\uC815\uD0C0: `); // "결정타: "
    const bCloser = extractLine(lines, `${nameB} \uACB0\uC815\uD0C0: `); // "결정타: "

    debateClash = {
      topic: debateTopic,
      rule,
      judge,
      aStance,
      aLogic,
      aCalm,
      aImpact,
      aTotal,
      bStance,
      bLogic,
      bCalm,
      bImpact,
      bTotal,
      aClaims,
      bClaims,
      aCloser,
      bCloser,
      aLine,
      bLine,
    };
  }

  return {
    headline,
    day,
    participantA,
    participantB,
    stake,
    nearMiss,
    tags,
    rounds,
    spotlightTags,
    cheer,
    revenge,
    courtTrial,
    debateClash,
    mode,
  };
}

function parseDebatePerfLine(line: string): {
  stance: string;
  logic: number;
  calm: number;
  impact: number;
  total: number;
} {
  // Format: "Name: stance | logic X calm Y impact Z | total N"
  const colonIdx = line.indexOf(": ");
  if (colonIdx < 0) return { stance: "", logic: 0, calm: 0, impact: 0, total: 0 };
  const rest = line.slice(colonIdx + 2);
  const segments = rest.split(" | ");

  const stance = (segments[0] || "").trim();
  let logic = 0, calm = 0, impact = 0, total = 0;

  for (const seg of segments) {
    const logicMatch = seg.match(/logic\s+(\d+)/);
    const calmMatch = seg.match(/calm\s+(\d+)/);
    const impactMatch = seg.match(/impact\s+(\d+)/);
    const totalMatch = seg.match(/total\s+(\d+)/);
    if (logicMatch) logic = parseInt(logicMatch[1], 10);
    if (calmMatch) calm = parseInt(calmMatch[1], 10);
    if (impactMatch) impact = parseInt(impactMatch[1], 10);
    if (totalMatch) total = parseInt(totalMatch[1], 10);
  }

  return { stance, logic, calm, impact, total };
}

/** Human-friendly mode label */
export function modeLabel(mode: string): string {
  switch (mode) {
    case "COURT_TRIAL":
      return "\uBAA8\uC758\uC7AC\uD310"; // "모의재판"
    case "DEBATE_CLASH":
      return "\uC124\uC804"; // "설전"
    default:
      return mode || "\uACBD\uAE30"; // "경기"
  }
}
