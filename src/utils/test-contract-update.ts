import { config } from 'dotenv';
import { 
    Client, 
    ContractExecuteTransaction, 
    ContractFunctionParameters,
    ContractCallQuery,
    PrivateKey,
    AccountId
} from '@hashgraph/sdk';

// Load environment variables
config();

async function testContractUpdate() {
    console.log('🔧 Testing Contract Update');
    console.log('==========================');

    try {
        // Initialize Hedera client
        const client = Client.forTestnet();
        
        // Handle DER format admin private key
        let adminPrivateKey: PrivateKey;
        try {
            // Try DER format first
            adminPrivateKey = PrivateKey.fromStringDer(process.env.HEDERA_PRIVATE_KEY!);
            console.log('✅ Using DER format admin private key');
        } catch (derError) {
            // Fallback to regular string format
            console.log('⚠️  DER format failed, trying regular format...');
            adminPrivateKey = PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY!);
            console.log('✅ Using regular format admin private key');
        }

        // Set operator with admin account
        client.setOperator(AccountId.fromString(process.env.HEDERA_ACCOUNT_ID!), adminPrivateKey);
        console.log('✅ Client initialized with admin operator:', process.env.HEDERA_ACCOUNT_ID);

        // Test ratios (same as from agent logs)
        const testRatios = {
            hbarRatio: 50,
            wbtcRatio: 3,
            sauceRatio: 7,
            usdcRatio: 20,
            jamRatio: 10,
            headstartRatio: 10
        };

        console.log('\n📊 Test Ratios:');
        console.log('HBAR:', testRatios.hbarRatio);
        console.log('WBTC:', testRatios.wbtcRatio);
        console.log('SAUCE:', testRatios.sauceRatio);
        console.log('USDC:', testRatios.usdcRatio);
        console.log('JAM:', testRatios.jamRatio);
        console.log('HEADSTART:', testRatios.headstartRatio);
        console.log('Total:', Object.values(testRatios).reduce((a, b) => a + b, 0));

        // Contract details
        const contractId = process.env.LYNX_CONTRACT!;
        console.log('\n🏛️ Contract ID:', contractId);
        
        // Query contract to get current admin address
        console.log('\n🔍 Querying contract state...');
        try {
            const adminQuery = new ContractCallQuery()
                .setContractId(contractId)
                .setFunction('ADMIN')
                .setGas(100000);
            
            const adminResult = await adminQuery.execute(client);
            const adminAddress = `0.0.${adminResult.getUint256(0).toString()}`;
            console.log('📋 Current ADMIN in contract:', adminAddress);
            console.log('📋 Expected ADMIN:', process.env.HEDERA_ACCOUNT_ID);
            
            if (adminAddress === process.env.HEDERA_ACCOUNT_ID) {
                console.log('✅ Admin addresses match!');
            } else {
                console.log('❌ Admin addresses DO NOT match!');
            }
            
            // Also get governance address
            const govQuery = new ContractCallQuery()
                .setContractId(contractId)
                .setFunction('GOVERNANCE')
                .setGas(100000);
            
            const govResult = await govQuery.execute(client);
            const govAddress = `0.0.${govResult.getUint256(0).toString()}`;
            console.log('📋 Current GOVERNANCE in contract:', govAddress);
            console.log('📋 Expected GOVERNANCE:', process.env.GOVERNANCE_ACCOUNT_ID || 'Not set');
            
            if (process.env.GOVERNANCE_ACCOUNT_ID && govAddress === process.env.GOVERNANCE_ACCOUNT_ID) {
                console.log('✅ Governance addresses match!');
            } else {
                console.log('❌ Governance addresses DO NOT match!');
            }
            
        } catch (queryError) {
            console.log('⚠️  Could not query contract state:', queryError instanceof Error ? queryError.message : queryError);
        }
        
        console.log('\n📞 Function: adminUpdateRatios (admin)');
        console.log('⛽ Gas: 1,000,000');

        // Create function parameters
        const functionParameters = new ContractFunctionParameters()
            .addUint256(testRatios.hbarRatio)
            .addUint256(testRatios.wbtcRatio)
            .addUint256(testRatios.sauceRatio)
            .addUint256(testRatios.usdcRatio)
            .addUint256(testRatios.jamRatio)
            .addUint256(testRatios.headstartRatio);

        // Create contract execution transaction
        const contractExecTx = new ContractExecuteTransaction()
            .setContractId(contractId)
            .setFunction('adminUpdateRatios', functionParameters)
            .setGas(1000000);

        console.log('\n🚀 Executing contract call...');
        
        // Execute transaction
        const response = await contractExecTx.execute(client);
        console.log('📋 Transaction ID:', response.transactionId.toString());

        // Get receipt
        const receipt = await response.getReceipt(client);
        console.log('✅ Transaction Status:', receipt.status.toString());

        if (receipt.status.toString() === 'SUCCESS') {
            console.log('\n🎉 Contract update successful!');
            console.log('✅ Token ratios have been updated on the contract');
        } else {
            console.log('\n❌ Contract update failed');
            console.log('Status:', receipt.status.toString());
        }

    } catch (error) {
        console.error('\n❌ Error testing contract update:', error);
        
        if (error instanceof Error) {
            console.error('Error message:', error.message);
            
            // Check for specific error patterns
            if (error.message.includes('CONTRACT_REVERT_EXECUTED')) {
                console.log('\n🔍 This is a contract revert - the contract rejected the call');
                console.log('💡 Possible causes:');
                console.log('   - Access control (not admin/governance)');
                console.log('   - Invalid ratio values (must be 1-100)');
                console.log('   - Contract validation failed');
                console.log('   - Insufficient gas');
            }
        }
    }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testContractUpdate().catch(console.error);
}

export { testContractUpdate };