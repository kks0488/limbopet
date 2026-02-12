

type Toast = { kind: "good" | "warn" | "bad"; text: string } | null;

export function ToastView({ toast }: { toast: Toast }) {
  return toast ? (
    <div className={`toast ${toast.kind}`} style={{ marginTop: 12 }}>
      {toast.text}
    </div>
  ) : null;
}
