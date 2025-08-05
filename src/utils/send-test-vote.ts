import { config } from 'dotenv';
import { Client, TopicMessageSubmitTransaction, TopicCreateTransaction, TopicInfoQuery, PrivateKey, AccountId, TopicId } from '@hashgraph/sdk';
import { MultiRatioVote, MultiRatioVoteSchema } from '../typescript/vote.js';

config({ path: '.env' });

async function getOrCreateVotingTopic(client: Client): Promise<string> {
  const existingTopicId = process.env.CURRENT_ROUND_VOTING_TOPIC;
  
  if (existingTopicId && existingTopicId !== '0.0.0') {
    try {
      // Try to query the existing topic to see if it's valid
      await new TopicInfoQuery()
        .setTopicId(existingTopicId)
        .execute(client);
      
      console.log('Using existing topic:', existingTopicId);
      return existingTopicId;
    } catch (error) {
      console.log('Existing topic not found or invalid, creating new topic...');
    }
  }
  
  // Create a new topic
  console.log('Creating new HCS-2 voting topic...');
  const createTopicTx = new TopicCreateTransaction()
    .setTopicMemo('hcs-2:0:86400'); // HCS-2 indexed topic, 1 day TTL
  
  const createResponse = await createTopicTx.execute(client);
  const createReceipt = await createResponse.getReceipt(client);
  const newTopicId = createReceipt.topicId!.toString();
  
  console.log('Created new topic with ID:', newTopicId);
  console.log('Add this to your .env file: CURRENT_ROUND_VOTING_TOPIC=' + newTopicId);
  
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

async function sendTestVote() {
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
    
    // Get or create voting topic
    const topicId = await getOrCreateVotingTopic(client);
    
    // Create a test vote
    const testVote: MultiRatioVote = {
      type: 'MULTI_RATIO_VOTE',
      ratioChanges: [
        { token: 'HBAR', newRatio: 40 },
        { token: 'USDC', newRatio: 30 },
        { token: 'WBTC', newRatio: 3 },
        { token: 'SAUCE', newRatio: 7 },
        { token: 'JAM', newRatio: 10 },
        { token: 'HEADSTART', newRatio: 10 }
      ],
      voterAccountId: process.env.HEDERA_ACCOUNT_ID!,
      votingPower: 1000,
      timestamp: new Date(),
      reason: 'Test vote for portfolio rebalancing'
    };
    
    // Validate the vote against schema
    const validatedVote = MultiRatioVoteSchema.parse(testVote);
    
    // Wrap in HCS-2 format
    const hcs2Message = {
      "p": "hcs-2",
      "op": "register",
      "t_id": topicId,
      "metadata": JSON.stringify(validatedVote),
      "m": "Governance vote submission"
    };
    
    // Convert HCS-2 message to JSON for submission
    const voteMessage = JSON.stringify(hcs2Message);
    
    // Submit to Hedera Consensus Service topic
    const transaction = new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(voteMessage);
    
    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);
    
    console.log('Vote submitted successfully!');
    console.log('Topic ID:', topicId);
    console.log('Transaction ID:', response.transactionId.toString());
    console.log('Status:', receipt.status.toString());
    console.log('Vote details:', JSON.stringify(validatedVote, null, 2));
    
  } catch (error) {
    console.error('Error sending test vote:', error);
  }
}

// Run the test
sendTestVote();