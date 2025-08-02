import { z } from 'zod';

export const AlertSchema = z.object({
  title: z.string(),
  message: z.string(),
  type: z.enum(['INFO', 'WARNING', 'ERROR']),
  timestamp: z.date()
});

export type Alert = z.infer<typeof AlertSchema>;