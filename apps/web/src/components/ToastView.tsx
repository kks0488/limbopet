

type Toast = { kind: "good" | "warn" | "bad"; text: string } | null;

export function ToastView({ toast }: { toast: Toast }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {toast ? (
        <div className={`toast ${toast.kind}`} style={{ marginTop: 12 }} role="status">
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}
