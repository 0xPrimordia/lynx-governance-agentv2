import { config } from 'dotenv';
import { Client, TopicMessageSubmitTransaction, TopicCreateTransaction, TopicInfoQuery, PrivateKey, AccountId, TopicId } from '@hashgraph/sdk';
import { AlertSchema, Alert } from '../typescript/alert.js';

config({ path: '.env' });

async function getOrCreateVotingTopic(client: Client): Promise<string> {
  const existingTopicId = process.env.DASHBOARD_ALERT_TOPIC;
  
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
  console.log('Creating new voting topic...');
  const createTopicTx = new TopicCreateTransaction()
    .setTopicMemo('Lynx Governance Dashboard Alert Topic')
    .setSubmitKey(client.operatorPublicKey!);
  
  const createResponse = await createTopicTx.execute(client);
  const createReceipt = await createResponse.getReceipt(client);
  const newTopicId = createReceipt.topicId!.toString();
  
  console.log('Created new topic with ID:', newTopicId);
  console.log('Add this to your .env file: DASHBOARD_ALERT_TOPIC=' + newTopicId);
  
  return newTopicId;
}

async function sendTestAlert() {
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
    const testVote: Alert = {
      title: 'Test Alert',
      message: 'This is a test alert',
      type: 'INFO',
      timestamp: new Date()
    };
    
    // Validate the vote against schema
    const validatedVote = AlertSchema.parse(testVote);
    
    // Convert vote to JSON for submission
    const voteMessage = JSON.stringify(validatedVote);
    
    // Submit to Hedera Consensus Service topic
    const transaction = new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(voteMessage);
    
    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);
    
    console.log('Alert submitted successfully!');
    console.log('Topic ID:', topicId);
    console.log('Transaction ID:', response.transactionId.toString());
    console.log('Status:', receipt.status.toString());
    console.log('Alert details:', JSON.stringify(validatedVote, null, 2));
    
  } catch (error) {
    console.error('Error sending test alert:', error);
  }
}

// Run the test
sendTestAlert();