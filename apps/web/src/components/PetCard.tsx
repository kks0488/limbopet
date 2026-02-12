
import type { PetStats, Pet } from "../lib/api";
import { MoodIndicator } from "./MoodIndicator";
import { ActionButtons } from "./ActionButtons";
import { jobIconMap, uiXpStar } from "../assets/index";

interface PetCardProps {
  pet: Pet;
  stats: PetStats | null;
  mood: { label: string; emoji: string };
  profileBadges: {
    mbti?: string;
    vibe?: string;
    job?: string;
    role?: string;
    company?: string;
  };
  progression: any;
  petAdvanced: boolean;
  petAnimClass?: string;
  showLevelUp?: boolean;
  /** Action feedback emoji shown over pet, e.g. "🍖" */
  actionFeedback?: string | null;
  // Action buttons props
  onAction?: (action: string) => void;
  onTalkClick?: () => void;
  actionBusy?: boolean;
  cooldowns?: Record<string, number>;
}

function clampInt(n: number, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function StatGauge({ label, value, icon, invert = false, warnAt = null }: {
  label: string;
  value: number;
  icon?: string;
  invert?: boolean;
  warnAt?: number | null;
}) {
  const v = clampInt(value ?? 0, 0, 100);
  const pct = clamp01(v / 100) * 100;
  const isWarn = warnAt === null ? false : invert ? v >= warnAt : v <= warnAt;
  const isDanger = invert ? v >= 85 : v <= 15;
  const cls = ["gauge", isDanger ? "danger" : "", isWarn ? "warn" : ""].filter(Boolean).join(" ");

  return (
    <div className={cls}>
      <div className="gaugeTop">
        <div className="gaugeLabel">
          {icon ? <span className="gaugeIcon">{icon}</span> : null}
          {label}
        </div>
        <div className="gaugeValue mono">{v}</div>
      </div>
      <div className="gaugeBar">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function PetCard({
  pet, stats, mood, profileBadges, progression,
  petAnimClass = "", showLevelUp = false, actionFeedback = null,
  onAction, onTalkClick, actionBusy = false, cooldowns = {},
}: PetCardProps) {
  const jobCode = profileBadges.job?.toLowerCase() || "";
  const jobIcon = jobIconMap[jobCode];
  const lv = Number(progression?.level ?? 1) || 1;
  const xp = Number(progression?.xp ?? 0) || 0;
  const need = Number(progression?.next_level_xp ?? 100) || 100;

  return (
    <div className="card petCardWrap">
      <div className="petHero">
        <div className="tamagotchiFrame">
          <MoodIndicator mood={mood.label} size={100} animClass={petAnimClass} />
          {actionFeedback ? (
            <div className="petActionFeedback" key={actionFeedback + Date.now()}>
              {actionFeedback}
            </div>
          ) : null}
        </div>
        {showLevelUp && <div className="levelUpFx" aria-hidden />}
        <div className="petInfo">
          <div className="petName">{pet.display_name || pet.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>{pet.description || "..."}</div>
          <div className="petLevelBadge">
            <img src={uiXpStar} alt="" style={{ width: 14, height: 14 }} />
            <span>Lv {lv}</span>
            <span className="muted" style={{ fontSize: 11 }}>{xp}/{need} XP</span>
          </div>
          <div className="row petBadges">
            {profileBadges.mbti ? <span className="badge">{profileBadges.mbti}</span> : null}
            {profileBadges.vibe ? <span className="badge">{profileBadges.vibe}</span> : null}
            {jobIcon ? (
              <span className="badge badgeWithIcon">
                <img src={jobIcon} alt="" style={{ width: 14, height: 14 }} />
                {profileBadges.job}
              </span>
            ) : profileBadges.job ? (
              <span className="badge">{profileBadges.job}</span>
            ) : null}
            {profileBadges.role ? <span className="badge">{profileBadges.role}</span> : null}
            {profileBadges.company ? <span className="badge">{profileBadges.company}</span> : null}
          </div>
        </div>
      </div>

      {onAction ? (
        <ActionButtons
          onAction={onAction}
          onTalkClick={onTalkClick}
          busy={actionBusy}
          cooldowns={cooldowns}
        />
      ) : null}

      <div className="petStats">
        <StatGauge label="배고픔" value={stats?.hunger ?? 50} icon="🍖" invert warnAt={80} />
        <StatGauge label="에너지" value={stats?.energy ?? 50} icon="⚡" warnAt={20} />
        <StatGauge label="기분" value={stats?.mood ?? 50} icon={mood.emoji} warnAt={35} />
      </div>
    </div>
  );
}

export { StatGauge };
