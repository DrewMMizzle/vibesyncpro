import { useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { ErrorBoundary } from "@/components/error-boundary";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import ProjectPage from "@/pages/project";
import OnboardPage from "@/pages/onboard";

function GitHubTokenErrorListener() {
  const { toast } = useToast();

  useEffect(() => {
    function onTokenError(e: Event) {
      const message = (e as CustomEvent).detail as string;
      toast({
        variant: "destructive",
        title: "GitHub access expired",
        description: message,
        action: (
          <ToastAction
            altText="Sign in again"
            onClick={() => {
              window.location.href = "/auth/github?redirect=/dashboard";
            }}
            data-testid="button-reauth-github"
          >
            Sign in again
          </ToastAction>
        ),
        duration: 15000,
      });
    }

    window.addEventListener("github-token-error", onTokenError);
    return () => window.removeEventListener("github-token-error", onTokenError);
  }, [toast]);

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/onboard" component={OnboardPage} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/projects/:id" component={ProjectPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <GitHubTokenErrorListener />
        <ErrorBoundary>
          <Router />
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
