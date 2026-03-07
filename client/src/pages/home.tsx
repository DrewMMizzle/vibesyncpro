import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { useCreateProject } from "@/hooks/use-projects";

export default function Home() {
  const [description, setDescription] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createProject = useCreateProject();

  useEffect(() => {
    if (!isSubmitted && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isSubmitted]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (!description.trim() || createProject.isPending) return;

    createProject.mutate(
      { description: description.trim() },
      {
        onSuccess: () => {
          setIsSubmitted(true);
        },
      }
    );
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
            {!isSubmitted ? (
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
                    disabled={!isFormValid || createProject.isPending}
                    className={`
                      group flex items-center gap-3 px-8 py-4 rounded-full text-base font-medium
                      transition-all duration-300 ease-out
                      ${isFormValid && !createProject.isPending
                        ? 'bg-foreground text-background shadow-lg cursor-pointer' 
                        : 'bg-muted-foreground/15 text-muted-foreground/40 cursor-not-allowed'}
                    `}
                  >
                    {createProject.isPending ? "Starting..." : "Get Started"}
                    {!createProject.isPending && (
                      <ArrowRight 
                        className={`w-5 h-5 transition-transform duration-300 ${isFormValid ? 'group-hover:translate-x-1' : ''}`} 
                      />
                    )}
                  </button>
                </motion.div>
              </motion.form>
            ) : (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col items-start gap-6"
              >
                <div className="w-16 h-16 rounded-full bg-foreground/5 flex items-center justify-center text-foreground mb-2">
                  <Check className="w-8 h-8" />
                </div>
                <h1
                  data-testid="text-success-message"
                  className="text-4xl sm:text-5xl md:text-6xl font-light text-foreground tracking-tight"
                >
                  Got it.
                  <br />
                  <span className="text-muted-foreground">Let's get to work.</span>
                </h1>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
