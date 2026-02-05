import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, AlertCircle, Sparkles, Shield, Zap, Mail, Lock, User } from "lucide-react";
import { useAuthStore } from "../../store/authStore";

type AuthMode = "login" | "signup";

export function LoginScreen() {
  const { loginWithEmail, signupWithEmail, isLoading, error, setError } = useAuthStore();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("Please enter email and password");
      return;
    }

    if (mode === "signup" && password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    try {
      if (mode === "login") {
        await loginWithEmail(email, password);
      } else {
        await signupWithEmail(email, password, name || undefined);
      }
    } catch {
      // Error is handled by the store
    }
  };

  const switchMode = () => {
    setMode(mode === "login" ? "signup" : "login");
    setError(null);
  };

  return (
    <div className="login-screen">
      <motion.div
        className="login-screen__container"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        {/* Brand Section */}
        <div className="login-screen__brand">
          <motion.div
            className="login-screen__logo"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <Sparkles size={32} />
          </motion.div>
          <h1 className="login-screen__title">Drovi</h1>
          <p className="login-screen__subtitle">Your AI-powered memory</p>
        </div>

        {/* Login Card */}
        <motion.div
          className="login-screen__card"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <h2 className="login-screen__card-title">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="login-screen__card-description">
            {mode === "login"
              ? "Sign in to access your memory and continue where you left off."
              : "Start organizing your communications with AI-powered intelligence."}
          </p>

          {error && (
            <div className="login-screen__error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-screen__form">
            {mode === "signup" && (
              <div className="login-screen__input-group">
                <label htmlFor="name" className="login-screen__label">
                  <User size={16} />
                  Name (optional)
                </label>
                <input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="login-screen__input"
                  disabled={isLoading}
                />
              </div>
            )}

            <div className="login-screen__input-group">
              <label htmlFor="email" className="login-screen__label">
                <Mail size={16} />
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="login-screen__input"
                disabled={isLoading}
                required
              />
            </div>

            <div className="login-screen__input-group">
              <label htmlFor="password" className="login-screen__label">
                <Lock size={16} />
                Password
              </label>
              <input
                id="password"
                type="password"
                placeholder={mode === "signup" ? "Min. 8 characters" : "Enter your password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-screen__input"
                disabled={isLoading}
                required
                minLength={mode === "signup" ? 8 : undefined}
              />
            </div>

            <button
              type="submit"
              className="login-screen__submit-btn"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} className="login-screen__spinner" />
                  <span>{mode === "login" ? "Signing in..." : "Creating account..."}</span>
                </>
              ) : (
                <span>{mode === "login" ? "Sign In" : "Create Account"}</span>
              )}
            </button>
          </form>

          <div className="login-screen__switch">
            <span>
              {mode === "login" ? "Don't have an account?" : "Already have an account?"}
            </span>
            <button
              type="button"
              onClick={switchMode}
              className="login-screen__switch-btn"
              disabled={isLoading}
            >
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </div>
        </motion.div>

        {/* Features Section */}
        <motion.div
          className="login-screen__features"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.4 }}
        >
          <div className="login-screen__feature">
            <Shield size={16} />
            <span>Your data stays private and secure</span>
          </div>
          <div className="login-screen__feature">
            <Zap size={16} />
            <span>AI-powered intelligence from your communications</span>
          </div>
        </motion.div>

        {/* Footer */}
        <div className="login-screen__footer">
          <p>
            By continuing, you agree to our{" "}
            <a href="https://drovi.io/terms" target="_blank" rel="noopener noreferrer">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="https://drovi.io/privacy" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
