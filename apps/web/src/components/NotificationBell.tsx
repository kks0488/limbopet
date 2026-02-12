
import { uiBell } from "../assets/index";

interface NotificationBellProps {
  count?: number;
  onClick?: () => void;
}

export function NotificationBell({ count = 0, onClick }: NotificationBellProps) {
  return (
    <button className={`notifBell ${count > 0 ? "notifBellActive" : ""}`} type="button" onClick={onClick}>
      <img src={uiBell} alt="알림" className="notifBellIcon" />
      {count > 0 ? <span className="notifBellCount">{count > 99 ? "99+" : count}</span> : null}
    </button>
  );
}
