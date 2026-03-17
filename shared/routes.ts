import { z } from 'zod';
import { insertProjectSchema } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

const projectCreateInput = insertProjectSchema.pick({
  name: true,
  description: true,
}).extend({
  github_repo_url: z.string().optional().nullable(),
  github_repo_name: z.string().optional().nullable(),
  connections: z.array(z.object({
    platform: z.enum(["replit", "claude_code", "computer"]),
    branch_name: z.string().nullable(),
  })).optional(),
});

export const api = {
  projects: {
    create: {
      method: 'POST' as const,
      path: '/api/projects' as const,
      input: projectCreateInput,
      responses: {
        201: z.object({
          id: z.number(),
          name: z.string(),
          description: z.string().nullable(),
          github_repo_url: z.string().nullable(),
          github_repo_name: z.string().nullable(),
          created_at: z.string().nullable(),
          platform_connections: z.array(z.any()),
        }),
        400: errorSchemas.validation,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type ProjectInput = z.infer<typeof api.projects.create.input>;
export type ProjectResponse = z.infer<typeof api.projects.create.responses[201]>;
