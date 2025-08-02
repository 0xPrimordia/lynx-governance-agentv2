import { z } from 'zod';
import { StructuredTool } from '@langchain/core/tools';
import { Client, ContractExecuteTransaction, ContractFunctionParameters } from '@hashgraph/sdk';

export class UpdateLynxContractTool extends StructuredTool {
    name = 'update_lynx_contract';
    description = 'Update the Lynx Token DAO contract with new token ratio weights from governance voting results.';
    schema = z.object({
        hbarRatio: z.number().min(0).max(100).describe('HBAR token ratio percentage'),
        wbtcRatio: z.number().min(0).max(100).describe('WBTC token ratio percentage'), 
        sauceRatio: z.number().min(0).max(100).describe('SAUCE token ratio percentage'),
        usdcRatio: z.number().min(0).max(100).describe('USDC token ratio percentage'),
        jamRatio: z.number().min(0).max(100).describe('JAM token ratio percentage'),
        headstartRatio: z.number().min(0).max(100).describe('HEADSTART token ratio percentage')
    });

    constructor(private client: Client) {
        super();
    }

    async _call(input: z.infer<typeof this.schema>): Promise<string> {
        const { hbarRatio, wbtcRatio, sauceRatio, usdcRatio, jamRatio, headstartRatio } = input;
        
        try {
            // Validate ratios sum to 100
            const totalRatio = hbarRatio + wbtcRatio + sauceRatio + usdcRatio + jamRatio + headstartRatio;
            if (Math.abs(totalRatio - 100) > 0.01) {
                throw new Error(`Token ratios must sum to 100%, got ${totalRatio}%`);
            }

            const contractId = process.env.LYNX_CONTRACT!;

            // Execute contract function updateRatios
            const functionParameters = new ContractFunctionParameters()
                .addUint256(hbarRatio)
                .addUint256(wbtcRatio)
                .addUint256(sauceRatio)
                .addUint256(usdcRatio)
                .addUint256(jamRatio)
                .addUint256(headstartRatio);

            const contractExecTx = new ContractExecuteTransaction()
                .setContractId(contractId)
                .setFunction('updateRatios', functionParameters)
                .setGas(300000);

            const response = await contractExecTx.execute(this.client);
            const receipt = await response.getReceipt(this.client);

            const result = {
                success: true,
                transactionId: response.transactionId.toString(),
                status: receipt.status.toString(),
                contractId: contractId,
                ratios: {
                    HBAR: hbarRatio,
                    WBTC: wbtcRatio,
                    SAUCE: sauceRatio,
                    USDC: usdcRatio,
                    JAM: jamRatio,
                    HEADSTART: headstartRatio
                }
            };

            console.log('Contract updated successfully:', result);
            return JSON.stringify(result, null, 2);

        } catch (error) {
            const errorResult = {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                ratios: { hbarRatio, wbtcRatio, sauceRatio, usdcRatio, jamRatio, headstartRatio }
            };
            
            console.error('Contract update failed:', errorResult);
            return JSON.stringify(errorResult, null, 2);
        }
    }
}