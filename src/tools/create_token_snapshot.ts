import { z } from 'zod';
import { StructuredTool } from '@langchain/core/tools';
import { Client, TopicMessageSubmitTransaction } from '@hashgraph/sdk';
import { createHash } from 'crypto';

export class CreateTokenSnapshotTool extends StructuredTool {
    name = 'create_token_snapshot';
    description = 'Create and send a token ratio snapshot based on governance voting results.';
    schema = z.object({
        hbarRatio: z.number().min(0).max(100).describe('HBAR token ratio percentage'),
        wbtcRatio: z.number().min(0).max(100).describe('WBTC token ratio percentage'), 
        sauceRatio: z.number().min(0).max(100).describe('SAUCE token ratio percentage'),
        usdcRatio: z.number().min(0).max(100).describe('USDC token ratio percentage'),
        jamRatio: z.number().min(0).max(100).describe('JAM token ratio percentage'),
        headstartRatio: z.number().min(0).max(100).describe('HEADSTART token ratio percentage'),
        sessionId: z.string().describe('Governance session identifier'),
        createdBy: z.string().describe('Account ID that created this snapshot')
    });

    constructor(private client: Client) {
        super();
    }

    async _call(input: z.infer<typeof this.schema>): Promise<string> {
        const { hbarRatio, wbtcRatio, sauceRatio, usdcRatio, jamRatio, headstartRatio, sessionId, createdBy } = input;
        
        try {
            // Keep token weights as ratios (same as contract values)
            const tokenWeights = {
                HBAR: hbarRatio,
                WBTC: wbtcRatio,
                SAUCE: sauceRatio,
                USDC: usdcRatio,
                JAM: jamRatio,
                HEADSTART: headstartRatio
            };

            // Create hash of token weights for integrity
            const weightsString = JSON.stringify(tokenWeights, Object.keys(tokenWeights).sort());
            const hash = createHash('sha256').update(weightsString).digest('hex');

            // Create snapshot data
            const snapshotData = {
                snapshot_id: `snapshot_${Date.now()}`,
                snapshot_type: 'token_ratios' as const,
                governance_session: sessionId,
                token_weights: tokenWeights,
                timestamp: new Date(),
                created_by: createdBy,
                hash: hash
            };

            // Wrap in HCS-2 format for non-indexed topic
            const hcs2Message = {
                p: 'hcs-2',
                op: 'register', 
                t_id: process.env.TOKEN_RATIO_SNAPSHOT_TOPIC!,
                metadata: JSON.stringify(snapshotData),
                m: 'Token ratio snapshot from governance voting'
            };

            // Send to snapshot topic
            const snapshotTopicId = process.env.TOKEN_RATIO_SNAPSHOT_TOPIC!;
            const transaction = new TopicMessageSubmitTransaction()
                .setTopicId(snapshotTopicId) 
                .setMessage(JSON.stringify(hcs2Message));

            const response = await transaction.execute(this.client);
            const receipt = await response.getReceipt(this.client);

            const result = {
                success: true,
                snapshotId: snapshotData.snapshot_id,
                transactionId: response.transactionId.toString(),
                status: receipt.status.toString(),
                topicId: snapshotTopicId,
                tokenWeights: tokenWeights,
                hash: hash
            };

            console.log('📸 Token snapshot created:', result);
            return JSON.stringify(result, null, 2);

        } catch (error) {
            const errorResult = {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                ratios: { hbarRatio, wbtcRatio, sauceRatio, usdcRatio, jamRatio, headstartRatio }
            };
            
            console.error('❌ Snapshot creation failed:', errorResult);
            return JSON.stringify(errorResult, null, 2);
        }
    }
}