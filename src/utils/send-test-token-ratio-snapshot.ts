import { config } from 'dotenv';
import { Client, TopicMessageSubmitTransaction, TopicCreateTransaction, TopicInfoQuery, PrivateKey, AccountId, TopicId } from '@hashgraph/sdk';
import { TokenRatioSnapshotData, TokenRatioSnapshotDataSchema } from '../typescript/snapshot.js';
import { createHash } from 'crypto';

config({ path: '.env' });

async function getOrCreateSnapshotTopic(client: Client): Promise<string> {
  const existingTopicId = process.env.TOKEN_RATIO_SNAPSHOT_TOPIC;
  
  if (existingTopicId && existingTopicId !== '0.0.0') {
    try {
      // Try to query the existing topic to see if it's valid
      await new TopicInfoQuery()
        .setTopicId(existingTopicId)
        .execute(client);
      
      console.log('Using existing snapshot topic:', existingTopicId);
      return existingTopicId;
    } catch (error) {
      console.log('Existing topic not found or invalid, creating new topic...');
    }
  }
  
  // Create a new topic (non-indexed since only latest snapshot matters)
  console.log('Creating new HCS-2 snapshot topic...');
  const createTopicTx = new TopicCreateTransaction()
    .setTopicMemo('hcs-2:1:3600') // HCS-2 non-indexed topic, 1 hour TTL
    .setSubmitKey(client.operatorPublicKey!);
  
  const createResponse = await createTopicTx.execute(client);
  const createReceipt = await createResponse.getReceipt(client);
  const newTopicId = createReceipt.topicId!.toString();
  
  console.log('Created new topic with ID:', newTopicId);
  console.log('Add this to your .env file: TOKEN_RATIO_SNAPSHOT_TOPIC=' + newTopicId);
  
  // Verify it's HCS-2 compliant
  const topicInfo = await new TopicInfoQuery()
    .setTopicId(newTopicId)
    .execute(client);
  
  const memo = topicInfo.topicMemo;
  const isHCS2 = memo.startsWith('hcs-2:');
  const parts = memo.split(':');
  
  console.log('Topic Memo:', memo);
  console.log('HCS-2 Compliant:', isHCS2);
  if (isHCS2 && parts.length === 3) {
    console.log('- Protocol:', parts[0]);
    console.log('- Indexed:', parts[1] === '0' ? 'Yes (all messages)' : 'No (latest only)');
    console.log('- TTL:', parts[2] + ' seconds');
  }
  
  return newTopicId;
}

async function sendTestSnapshot() {
  try {
    // Initialize Hedera client
    const operatorId = AccountId.fromString(process.env.HEDERA_ACCOUNT_ID!);
    
    // Handle DER format private key
    let operatorPrivateKey: PrivateKey;
    try {
      // Try DER format first
      operatorPrivateKey = PrivateKey.fromStringDer(process.env.HEDERA_PRIVATE_KEY!);
    } catch (derError) {
      // Fallback to regular string format
      console.log('DER format failed, trying regular format...');
      operatorPrivateKey = PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY!);
    }
    
    const client = Client.forTestnet().setOperator(operatorId, operatorPrivateKey);
    
    // Get or create snapshot topic
    const topicId = await getOrCreateSnapshotTopic(client);
    
    // Create test token weights
    const tokenWeights = {
      'HBAR': 0.60,
      'USDC': 0.30,
      'BTC': 0.10
    };
    
    // Generate hash for integrity
    const weightsString = JSON.stringify(tokenWeights, Object.keys(tokenWeights).sort());
    const hash = createHash('sha256').update(weightsString).digest('hex');
    
    // Create a test snapshot
    const testSnapshot: TokenRatioSnapshotData = {
      snapshot_id: `snapshot_${Date.now()}`,
      snapshot_type: 'token_ratios',
      governance_session: 'session_2024_q1',
      token_weights: tokenWeights,
      timestamp: new Date(),
      created_by: process.env.HEDERA_ACCOUNT_ID!,
      hash: hash
    };
    
    // Validate the snapshot against schema
    const validatedSnapshot = TokenRatioSnapshotDataSchema.parse(testSnapshot);
    
    // Wrap in HCS-2 format
    const hcs2Message = {
      "p": "hcs-2",
      "op": "register",
      "t_id": topicId,
      "metadata": JSON.stringify(validatedSnapshot),
      "m": "Token ratio snapshot"
    };
    
    // Convert HCS-2 message to JSON for submission
    const snapshotMessage = JSON.stringify(hcs2Message);
    
    // Submit to Hedera Consensus Service topic
    const transaction = new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(snapshotMessage);
    
    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);
    
    console.log('Snapshot submitted successfully!');
    console.log('Topic ID:', topicId);
    console.log('Transaction ID:', response.transactionId.toString());
    console.log('Status:', receipt.status.toString());
    console.log('Snapshot details:', JSON.stringify(validatedSnapshot, null, 2));
    
  } catch (error) {
    console.error('Error sending test snapshot:', error);
  }
}

// Run the test
sendTestSnapshot();