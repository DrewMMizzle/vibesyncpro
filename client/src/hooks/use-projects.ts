import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { api, type ProjectInput } from "@shared/routes";

export function useCreateProject() {
  return useMutation({
    mutationFn: async (data: ProjectInput) => {
      const validatedInput = api.projects.create.input.parse(data);

      const res = await fetch(api.projects.create.path, {
        method: api.projects.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validatedInput),
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Not authenticated");
        }
        if (res.status === 400) {
          const errorData = await res.json();
          throw new Error(errorData.message || "Validation failed");
        }
        throw new Error("Failed to create project");
      }

      const responseData = await res.json();
      return api.projects.create.responses[201].parse(responseData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    },
  });
}
