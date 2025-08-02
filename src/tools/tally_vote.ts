import { z } from 'zod';
import { StructuredTool } from '@langchain/core/tools';
import { MultiRatioVoteSchema, MultiRatioVote } from '../typescript/vote.js';

export class TallyVoteTool extends StructuredTool {
    name = 'tally_vote';
    description = 'This tool is used to tally the votes for the Lynx Token DAO Parameters and return the results.';
    schema = z.array(MultiRatioVoteSchema);

    async _call(input: z.infer<typeof this.schema>): Promise<string> {
        const votes = input;
        
        // Process votes - latest vote per voter wins
        const voterMap = new Map<string, MultiRatioVote>();
        for (const vote of votes) {
            const existing = voterMap.get(vote.voterAccountId);
            if (!existing || vote.timestamp > existing.timestamp) {
                voterMap.set(vote.voterAccountId, vote);
            }
        }
        
        const finalVotes = Array.from(voterMap.values());
        const totalVotingPower = finalVotes.reduce((sum, vote) => sum + vote.votingPower, 0);
        
        // Tally votes by token and ratio
        const tokenTallies: Record<string, Record<number, number>> = {};
        for (const vote of finalVotes) {
            for (const ratioChange of vote.ratioChanges) {
                if (!tokenTallies[ratioChange.token]) {
                    tokenTallies[ratioChange.token] = {};
                }
                if (!tokenTallies[ratioChange.token][ratioChange.newRatio]) {
                    tokenTallies[ratioChange.token][ratioChange.newRatio] = 0;
                }
                tokenTallies[ratioChange.token][ratioChange.newRatio] += vote.votingPower;
            }
        }
        
        // Determine winners
        const results: Record<string, {
            winningRatio: number;
            winningVotingPower: number;
            totalOptions: number;
        }> = {};
        for (const [token, ratios] of Object.entries(tokenTallies)) {
            let winningRatio = 0;
            let winningPower = 0;
            
            for (const [ratio, power] of Object.entries(ratios)) {
                if (power > winningPower) {
                    winningRatio = parseInt(ratio);
                    winningPower = power;
                }
            }
            
            results[token] = {
                winningRatio,
                winningVotingPower: winningPower,
                totalOptions: Object.keys(ratios).length
            };
        }
        
        return JSON.stringify({
            totalVotingPower,
            voterCount: finalVotes.length,
            tokenResults: results
        }, null, 2);
    }
}