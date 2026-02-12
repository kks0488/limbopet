

/** Subtle ambient light dots — Apple HIG style */
export function FloatingParticles() {
  return (
    <div className="floatingParticles" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="particle" />
      ))}
    </div>
  );
}
