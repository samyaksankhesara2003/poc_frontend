import axios from "axios";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

const STORAGE_KEY = "poc_user";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await axios.post(`${API_BASE}/poc/login`, { email });
      if (!data.status) {
        setError(data.message || "Login failed");
        setLoading(false);
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data.data));
      navigate("/profile", { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>Waiter Login</h2>
        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            style={styles.input}
            autoComplete="email"
          />
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export { STORAGE_KEY };

const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
  },
  card: {
    background: "#0f3460",
    padding: 32,
    borderRadius: 12,
    boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
    width: "100%",
    maxWidth: 380,
  },
  title: {
    margin: "0 0 24px",
    color: "#e94560",
    fontSize: 24,
    fontWeight: 600,
  },
  form: { display: "flex", flexDirection: "column", gap: 16 },
  label: {
    color: "#a2a8d3",
    fontSize: 14,
    fontWeight: 500,
  },
  input: {
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid #16213e",
    background: "#16213e",
    color: "#eee",
    fontSize: 16,
  },
  error: {
    color: "#e94560",
    margin: 0,
    fontSize: 14,
  },
  button: {
    padding: "12px 20px",
    borderRadius: 8,
    border: "none",
    background: "#e94560",
    color: "#fff",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 8,
  },
};
