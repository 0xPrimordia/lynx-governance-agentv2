import { config } from 'dotenv';
import { Client, TopicMessageQuery, PrivateKey, AccountId } from '@hashgraph/sdk';

config();

async function checkTopicMessages() {
    console.log('🔍 Topic Message Inspector');
    console.log('===========================');

    try {
        // Initialize Hedera client
        const client = Client.forTestnet();
        
        // Handle DER format private key
        let operatorPrivateKey: PrivateKey;
        try {
            operatorPrivateKey = PrivateKey.fromStringDer(process.env.HEDERA_PRIVATE_KEY!);
            console.log('✅ Using DER format private key');
        } catch (derError) {
            console.log('⚠️  DER format failed, trying regular format...');
            operatorPrivateKey = PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY!);
            console.log('✅ Using regular format private key');
        }

        client.setOperator(AccountId.fromString(process.env.HEDERA_ACCOUNT_ID!), operatorPrivateKey);

        // Topic to inspect
        const topicId = process.env.CURRENT_ROUND_VOTING_TOPIC!;
        console.log('📊 Inspecting topic:', topicId);
        console.log('🕒 Fetching messages from the last 24 hours...\n');

        const messages: any[] = [];
        let messageCount = 0;

        // Query messages from the last 24 hours
        const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

        await new Promise<void>((resolve, reject) => {
            const subscription = new TopicMessageQuery()
                .setTopicId(topicId)
                .setStartTime(startTime)
                .subscribe(
                    client,
                    (message, error) => {
                        if (error) {
                            console.error('❌ Subscription error:', error);
                            reject(error);
                            return;
                        }
                    },
                    (message) => {
                        try {
                            messageCount++;
                            const rawMessage = Buffer.from(message.contents).toString('utf8');
                            const timestamp = new Date(message.consensusTimestamp.toDate());
                            
                            console.log(`📨 Message #${messageCount}`);
                            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                            console.log('🕒 Timestamp:', timestamp.toLocaleString());
                            console.log('📏 Size:', rawMessage.length + ' characters');
                            console.log('🔗 Sequence:', message.sequenceNumber.toString());
                            
                            // Try to parse as JSON (HCS-2 format)
                            try {
                                const parsed = JSON.parse(rawMessage);
                                console.log('✅ Valid JSON');
                                
                                // Check if it's HCS-2 format
                                if (parsed.p === 'hcs-2') {
                                    console.log('🏷️  Format: HCS-2');
                                    console.log('🔧 Operation:', parsed.op);
                                    console.log('📍 Topic ID:', parsed.t_id);
                                    console.log('💬 Message:', parsed.m);
                                    
                                    // Try to parse metadata
                                    if (parsed.metadata) {
                                        try {
                                            const metadata = JSON.parse(parsed.metadata);
                                            console.log('📋 Metadata Type:', metadata.type || 'Unknown');
                                            
                                            if (metadata.type === 'MULTI_RATIO_VOTE') {
                                                console.log('👤 Voter:', metadata.voterAccountId);
                                                console.log('⚡ Power:', metadata.votingPower);
                                                console.log('📊 Ratios:', metadata.ratioChanges?.map(r => `${r.token}(${r.newRatio}%)`).join(', '));
                                                console.log('💭 Reason:', metadata.reason || 'None');
                                            } else {
                                                console.log('📄 Metadata:', JSON.stringify(metadata, null, 2));
                                            }
                                        } catch (metaError) {
                                            console.log('❌ Invalid metadata JSON');
                                            console.log('📄 Raw metadata:', parsed.metadata.substring(0, 200) + '...');
                                        }
                                    }
                                } else {
                                    console.log('🏷️  Format: Custom JSON');
                                    console.log('📄 Content:', JSON.stringify(parsed, null, 2));
                                }
                            } catch (parseError) {
                                console.log('❌ Not valid JSON');
                                console.log('📄 Raw content:', rawMessage.substring(0, 300) + (rawMessage.length > 300 ? '...' : ''));
                            }
                            
                            console.log(''); // Empty line for readability
                            
                            messages.push({
                                sequence: message.sequenceNumber.toString(),
                                timestamp,
                                content: rawMessage,
                                size: rawMessage.length
                            });

                        } catch (error) {
                            console.error('❌ Error processing message:', error);
                        }
                    }
                );

            // Stop after 10 seconds to avoid hanging
            setTimeout(() => {
                subscription.unsubscribe();
                resolve();
            }, 10000);
        });

        console.log('📊 Summary');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Total messages found:', messageCount);
        console.log('Topic ID:', topicId);
        console.log('Time range: Last 24 hours');

        client.close();

    } catch (error) {
        console.error('❌ Error inspecting topic:', error);
    }
}

// Run the inspection
checkTopicMessages();