import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { useCreateProject } from "@/hooks/use-projects";

export default function Home() {
  const [description, setDescription] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createProject = useCreateProject();

  // Focus the input automatically for a native/seamless feel
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
    <main className="min-h-screen w-full flex flex-col items-center justify-center p-6 sm:p-12 overflow-hidden bg-background">
      <div className="w-full max-w-3xl mx-auto relative">
        <AnimatePresence mode="wait">
          {!isSubmitted ? (
            <motion.form
              key="form"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              onSubmit={handleSubmit}
              className="flex flex-col gap-12"
            >
              <div className="space-y-4">
                <motion.label
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.5 }}
                  htmlFor="description"
                  className="block text-sm font-medium text-muted-foreground uppercase tracking-widest"
                >
                  Project Setup
                </motion.label>
                
                <input
                  ref={inputRef}
                  id="description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What are you building?"
                  className="w-full bg-transparent text-4xl sm:text-5xl md:text-6xl font-light text-foreground placeholder:text-muted-foreground/30 border-b-2 border-muted hover:border-muted-foreground/50 focus:border-foreground focus:outline-none focus:ring-0 pb-4 transition-colors rounded-none"
                  autoComplete="off"
                  spellCheck="false"
                />
              </div>

              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.5 }}
                className="flex items-center"
              >
                <button
                  type="submit"
                  disabled={!isFormValid || createProject.isPending}
                  className={`
                    group flex items-center gap-3 px-8 py-4 rounded-full text-base font-medium
                    transition-all duration-300 ease-out
                    ${isFormValid 
                      ? 'bg-foreground text-background hover:scale-105 active:scale-95 shadow-xl shadow-foreground/10' 
                      : 'bg-muted text-muted-foreground cursor-not-allowed'}
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
              <div className="w-16 h-16 rounded-full bg-primary/5 flex items-center justify-center text-primary mb-2">
                <Check className="w-8 h-8" />
              </div>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-light text-foreground tracking-tight">
                Got it.
                <br />
                <span className="text-muted-foreground">Let's get to work.</span>
              </h1>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
