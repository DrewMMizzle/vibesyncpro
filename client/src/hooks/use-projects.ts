import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { api, type ProjectInput } from "@shared/routes";

export function useCreateProject() {
  return useMutation({
    mutationFn: async (data: ProjectInput) => {
      const validatedInput = api.projects.create.input.parse(data);

      const res = await apiRequest(
        api.projects.create.method,
        api.projects.create.path,
        validatedInput,
      );

      const responseData = await res.json();
      return api.projects.create.responses[201].parse(responseData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    },
  });
}
