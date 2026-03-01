/**
 * Transcript display with Soniox-style partial (lighter) and final (darker) text.
 * Provisional text appears in light gray first, then is replaced by darker final text.
 * @see https://soniox.com/compare/
 */
export default function TranscriptWithPartial({
  transcript = [],
  partial = null,
  hint = null,
  emptyMessage = "No conversation yet.",
}) {
  const hasPartial = partial && (partial.text || "").trim().length > 0;
  const hasAny = transcript.length > 0 || hasPartial;

  return (
    <div style={styles.box}>
      {hint && <div style={styles.hint}>{hint}</div>}
      {!hasAny ? (
        <div style={styles.empty}>{emptyMessage}</div>
      ) : (
        <>
          {transcript.map((t, i) => (
            <div key={`f-${i}`} style={styles.line}>
              <span style={speakerPill(t.speaker === "S1")}>
                {t.speaker === "S1" ? "WAITER" : "CUSTOMER"}
              </span>
              <span style={styles.finalText}>{t.text || "\u00a0"}</span>
            </div>
          ))}
          {hasPartial && (
            <div style={styles.line}>
              <span style={speakerPill(partial.speaker === "S1")}>
                {partial.speaker === "S1" ? "WAITER" : "CUSTOMER"}
              </span>
              <span style={styles.partialText}>{partial.text || "\u00a0"}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function speakerPill(isWaiter) {
  return {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    flexShrink: 0,
    background: isWaiter ? "#66bb6a" : "#42a5f5",
  };
}

const styles = {
  box: {
    border: "1px solid #ccc",
    borderRadius: 8,
    padding: 15,
    minHeight: 320,
    maxHeight: 400,
    overflowY: "auto",
    background: "#f9f9f9",
    fontSize: 16,
    lineHeight: 1.6,
  },
  hint: {
    fontSize: 13,
    color: "#666",
    marginBottom: 12,
  },
  empty: {
    color: "#999",
    fontStyle: "italic",
  },
  line: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  finalText: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 1.5,
    color: "#111",
    fontWeight: 500,
  },
  partialText: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 1.5,
    color: "#888",
    fontStyle: "italic",
  },
};
