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
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .login-card {
          animation: fadeIn 0.5s ease-out;
        }
        button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 16px -4px rgba(99, 102, 241, 0.4) !important;
        }
        button:active:not(:disabled) {
          transform: translateY(0);
        }
        input:focus {
          outline: none;
          border-color: #6366f1 !important;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1) !important;
        }
      `}</style>
      <div className="login-card" style={styles.card}>
        <div style={styles.header}>
          <div style={styles.logoContainer}>
            <span style={styles.logo}>🍽️</span>
          </div>
          <h1 style={styles.title}>Welcome Back</h1>
          <p style={styles.subtitle}>Sign in to your waiter account</p>
        </div>
        
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              <span style={styles.labelIcon}>📧</span>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="waiter@restaurant.com"
              required
              style={styles.input}
              autoComplete="email"
            />
          </div>
          
          {error && (
            <div style={styles.errorCard}>
              <span style={styles.errorIcon}>⚠️</span>
              <span>{error}</span>
            </div>
          )}
          
          <button 
            type="submit" 
            disabled={loading} 
            style={{
              ...styles.button,
              ...(loading ? styles.buttonLoading : {}),
            }}
          >
            {loading ? (
              <>
                <span style={styles.spinner}></span>
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <span>🔐</span>
                <span>Sign In</span>
              </>
            )}
          </button>
        </form>
        
        <div style={styles.footer}>
          <p style={styles.footerText}>Secure authentication powered by AI</p>
        </div>
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
    padding: 24,
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
  },
  card: {
    background: "#ffffff",
    padding: "48px 40px",
    borderRadius: 24,
    boxShadow: "0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1)",
    width: "100%",
    maxWidth: 440,
    position: "relative",
    overflow: "hidden",
  },
  header: {
    textAlign: "center",
    marginBottom: 32,
  },
  logoContainer: {
    marginBottom: 16,
  },
  logo: {
    fontSize: 56,
    display: "inline-block",
  },
  title: {
    margin: "0 0 8px",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    fontSize: 32,
    fontWeight: 700,
    letterSpacing: -0.5,
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
    fontSize: 15,
    fontWeight: 400,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  label: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "#475569",
    fontSize: 14,
    fontWeight: 600,
  },
  labelIcon: {
    fontSize: 16,
  },
  input: {
    padding: "14px 16px",
    borderRadius: 12,
    border: "2px solid #e2e8f0",
    background: "#ffffff",
    color: "#1e293b",
    fontSize: 15,
    fontWeight: 400,
    transition: "all 0.2s ease",
    fontFamily: "inherit",
  },
  errorCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 12,
    color: "#991b1b",
    fontSize: 14,
    fontWeight: 500,
  },
  errorIcon: {
    fontSize: 18,
  },
  button: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "16px 24px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: "#ffffff",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 8,
    transition: "all 0.2s ease",
    boxShadow: "0 4px 12px rgba(102, 126, 234, 0.4)",
  },
  buttonLoading: {
    opacity: 0.8,
    cursor: "not-allowed",
  },
  spinner: {
    width: 18,
    height: 18,
    border: "3px solid rgba(255,255,255,0.3)",
    borderTopColor: "#ffffff",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  footer: {
    marginTop: 32,
    paddingTop: 24,
    borderTop: "1px solid #f1f5f9",
    textAlign: "center",
  },
  footerText: {
    margin: 0,
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: 400,
  },
};
