import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

export default function Home() {
  const [description, setDescription] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!authLoading && isLoggedIn && !params.has("stay")) {
      navigate("/dashboard");
    }
  }, [authLoading, isLoggedIn, navigate]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!description.trim()) return;

    const trimmed = description.trim();
    if (!isLoggedIn) {
      sessionStorage.setItem("onboard_name", trimmed);
      window.location.href = `/auth/github?redirect=${encodeURIComponent("/onboard")}`;
      return;
    }

    navigate(`/onboard?name=${encodeURIComponent(trimmed)}`);
  };

  const isFormValid = description.trim().length > 0;

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <header className="absolute top-0 left-0 p-6 sm:p-8 z-10">
        <span
          data-testid="text-wordmark"
          className="text-sm font-medium tracking-wide text-muted-foreground/50 select-none"
        >
          VibeSyncPro
        </span>
      </header>

      <main className="min-h-screen w-full flex items-center justify-center p-6 sm:p-12" style={{ paddingBottom: '10vh' }}>
        <div className="w-full max-w-2xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.form
              key="form"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              onSubmit={handleSubmit}
              className="flex flex-col gap-10"
            >
              <motion.h1
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                data-testid="text-heading"
                className="text-4xl sm:text-5xl md:text-6xl font-light text-muted-foreground/40 tracking-tight"
              >
                What are you building?
              </motion.h1>

              <input
                ref={inputRef}
                id="description"
                data-testid="input-description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="a todo app, a portfolio site..."
                className="w-full bg-transparent text-2xl sm:text-3xl font-light text-foreground placeholder:text-muted-foreground/25 border-b-2 border-muted hover:border-muted-foreground/50 focus:border-foreground focus:outline-none focus:ring-0 pb-4 transition-colors rounded-none"
                autoComplete="off"
                spellCheck="false"
              />

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.5 }}
                className="flex items-center"
              >
                <button
                  type="submit"
                  data-testid="button-get-started"
                  disabled={!isFormValid || authLoading}
                  className={`
                    group flex items-center gap-3 px-8 py-4 rounded-full text-base font-medium
                    transition-all duration-300 ease-out
                    ${isFormValid && !authLoading
                      ? 'bg-foreground text-background shadow-lg cursor-pointer'
                      : 'bg-muted-foreground/15 text-muted-foreground/40 cursor-not-allowed'}
                  `}
                >
                  Get Started
                  <ArrowRight
                    className={`w-5 h-5 transition-transform duration-300 ${isFormValid ? 'group-hover:translate-x-1' : ''}`}
                  />
                </button>
              </motion.div>
            </motion.form>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
