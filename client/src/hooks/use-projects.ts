import { useMutation } from "@tanstack/react-query";
import { api, type ProjectInput } from "@shared/routes";

function parseWithLogging<T>(schema: any, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[Zod] ${label} validation failed:`, result.error.format());
    throw result.error;
  }
  return result.data;
}

export function useCreateProject() {
  return useMutation({
    mutationFn: async (data: ProjectInput) => {
      // Validate input before sending
      const validatedInput = api.projects.create.input.parse(data);

      const res = await fetch(api.projects.create.path, {
        method: api.projects.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validatedInput),
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 400) {
          const errorData = await res.json();
          const error = parseWithLogging(api.projects.create.responses[400], errorData, "projects.create.error");
          throw new Error(error.message || "Validation failed");
        }
        throw new Error("Failed to create project");
      }

      const responseData = await res.json();
      return parseWithLogging(
        api.projects.create.responses[201],
        responseData,
        "projects.create.success"
      );
    },
  });
}
