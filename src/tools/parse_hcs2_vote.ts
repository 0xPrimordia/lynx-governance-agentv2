import { z } from 'zod';
import { StructuredTool } from '@langchain/core/tools';
import { MultiRatioVoteSchema, MultiRatioVote } from '../typescript/vote.js';

const HCS2MessageSchema = z.object({
  p: z.literal('hcs-2'),
  op: z.literal('register'),
  t_id: z.string(),
  metadata: z.string(),
  m: z.string().optional()
});

export class ParseHCS2VoteTool extends StructuredTool {
    name = 'parse_hcs2_vote';
    description = 'Parse raw HCS-2 topic message to extract and validate governance vote data from metadata field.';
    schema = z.object({
        rawMessage: z.string().describe('Raw topic message content to parse')
    });

    async _call(input: z.infer<typeof this.schema>): Promise<string> {
        const { rawMessage } = input;
        
        try {
            // Parse the raw message as JSON
            let messageContent;
            try {
                messageContent = JSON.parse(rawMessage);
            } catch (jsonError) {
                return JSON.stringify({
                    success: false,
                    error: 'Invalid JSON in raw message',
                    rawMessage: rawMessage.substring(0, 100) + '...'
                });
            }

            // Validate HCS-2 message structure
            const hcs2Message = HCS2MessageSchema.parse(messageContent);
            
            // Extract and parse vote metadata
            let voteData;
            try {
                voteData = JSON.parse(hcs2Message.metadata);
            } catch (metadataError) {
                return JSON.stringify({
                    success: false,
                    error: 'Invalid JSON in metadata field',
                    metadata: hcs2Message.metadata.substring(0, 100) + '...'
                });
            }

            // Validate vote data against schema (z.coerce.date() auto-converts timestamp strings)
            const validatedVote = MultiRatioVoteSchema.parse(voteData);
            
            const result = {
                success: true,
                vote: validatedVote,
                hcs2Info: {
                    topicId: hcs2Message.t_id,
                    operation: hcs2Message.op,
                    memo: hcs2Message.m
                }
            };

            return JSON.stringify(result, null, 2);

        } catch (error) {
            const errorResult = {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown parsing error',
                errorType: error instanceof z.ZodError ? 'ValidationError' : 'ParseError',
                details: error instanceof z.ZodError ? error.errors : undefined
            };
            
            return JSON.stringify(errorResult, null, 2);
        }
    }
}