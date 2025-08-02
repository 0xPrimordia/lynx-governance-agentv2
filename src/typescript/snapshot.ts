import { z } from 'zod';

export const TokenRatioSnapshotDataSchema = z.object({
  snapshot_id: z.string().describe('Unique identifier for this snapshot'),
  snapshot_type: z.literal('token_ratios'),
  governance_session: z.string().describe('Session this snapshot belongs to'),
  token_weights: z.record(z.string(), z.number()).describe('Token ratio weights'),
  timestamp: z.date(),
  created_by: z.string().regex(/^0\.0\.\d+$/),
  hash: z.string().describe('Integrity hash of token ratios')
});

export type TokenRatioSnapshotData = z.infer<typeof TokenRatioSnapshotDataSchema>;
