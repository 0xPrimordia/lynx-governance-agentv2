import { z } from 'zod';

export const MultiRatioVoteSchema = z.object({
  type: z.literal('MULTI_RATIO_VOTE'),          // Identifies this as a multi-ratio vote
  ratioChanges: z.array(z.object({
    token: z.string(),                          // Token identifier
    newRatio: z.number().min(0).max(100),       // New ratio (0-100%)
  })),
  voterAccountId: z.string().regex(/^0\.0\.\d+$/),  // Hedera account ID format
  votingPower: z.number().min(0),               // Voter's voting power
  timestamp: z.coerce.date(),                   // When the vote was cast (auto-converts strings)
  txId: z.string().optional(),                  // Optional transaction ID
  reason: z.string().optional(),                // Optional reason for the vote
});

export type MultiRatioVote = z.infer<typeof MultiRatioVoteSchema>;
