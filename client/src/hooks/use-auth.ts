import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

interface AuthUser {
  id: number;
  username: string;
  avatarUrl: string | null;
}

export function useAuth() {
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  return {
    user: user ?? null,
    isLoading,
    isLoggedIn: !!user,
  };
}
