import { config } from 'dotenv';
import { EnvironmentConfig } from './agent-env.js';
import { Client, TopicMessage, TopicMessageQuery, PrivateKey } from '@hashgraph/sdk';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { AgentMode, coreConsensusPlugin, coreQueriesPlugin, HederaLangchainToolkit } from 'hedera-agent-kit';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { CalculateWinningRatiosTool } from '../tools/calculate_winning_ratios.js';
import { UpdateLynxContractTool } from '../tools/update_lynx_contract.js';
import { ParseHCS2VoteTool } from '../tools/parse_hcs2_vote.js';
import { CreateTokenSnapshotTool } from '../tools/create_token_snapshot.js';

config();

const QUORUM_THRESHOLD = 1000;

// next to do: setup agent too track quorum threshold vs total voting power
// update lynx contract with winning token/ratios
// post new token/ratios to the snapshot topic
// send balancer alert for winning token/ratios
// send dashboard alerts along the way

export class LynxGovernanceAgent {
    private environment: EnvironmentConfig;
    private hederaAgentToolkit?: HederaLangchainToolkit;
    private agentExecutor?: AgentExecutor;
    private client?: Client;
    private isRunning: boolean = false;
    
    // State management for governance
    private collectedVotes: any[] = [];
    private currentVotingPower: number = 0;

    constructor() {
        this.environment = process.env as NodeJS.ProcessEnv & EnvironmentConfig;
    }

    async initialize(): Promise<void> {
        console.log("🦌⚡ Initializing Lynx Governance Agent");
        console.log("=========================================");

        const requiredVars = [
            'HEDERA_NETWORK',
            'HEDERA_ACCOUNT_ID',
            'HEDERA_PRIVATE_KEY',
            'AI_GATEWAY_API_KEY',
            'LYNX_CONTRACT',
        ];
        const missingVars = requiredVars.filter(varName => !this.environment[varName]);
        if (missingVars.length > 0) {
            throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
        }

        await this.initializeGovernanceAgent();
    }

    private async initializeGovernanceAgent(): Promise<void> {
        try {
            this.client = Client.forTestnet();
            
            // Handle DER format private key
            let operatorPrivateKey: PrivateKey;
            try {
                // Try DER format first
                operatorPrivateKey = PrivateKey.fromStringDer(this.environment.HEDERA_PRIVATE_KEY!);
            } catch (derError) {
                // Fallback to regular string format
                console.log('DER format failed, trying regular format...');
                operatorPrivateKey = PrivateKey.fromString(this.environment.HEDERA_PRIVATE_KEY!);
            }
            
            this.client.setOperator(this.environment.HEDERA_ACCOUNT_ID!, operatorPrivateKey);
            this.hederaAgentToolkit = new HederaLangchainToolkit({
                client: this.client,
                configuration: {
                tools: [], // empty array loads all tools
                context: {
                    mode: AgentMode.AUTONOMOUS,
                },
                plugins: [coreConsensusPlugin, coreQueriesPlugin],
                }
            });

            const llm = new ChatOpenAI({
                modelName: "gpt-4o-mini",
                temperature: 0,
                configuration: {
                    baseURL: "https://ai-gateway.vercel.sh/v1",
                },
                apiKey: this.environment.AI_GATEWAY_API_KEY!,
            });

            const prompt = ChatPromptTemplate.fromMessages([
                ["system", `You are the Lynx Governance Agent, responsible for managing decentralized governance voting for token portfolio ratios.

                CORE RESPONSIBILITIES:
                - Monitor HCS-2 voting topic for incoming governance votes
                - Track total voting power and maintain running count
                - Trigger vote tallying when quorum threshold (${QUORUM_THRESHOLD}) is reached
                - Update smart contract ratios based on governance results
                - Send real-time alerts and notifications throughout the process

                                 VOTING PROCESS:
                 1. Use parse_hcs2_vote tool to extract vote data from raw HCS-2 message
                 2. Add parsed vote to COLLECTED_VOTES array and votingPower to RUNNING_VOTE_TOTAL
                 3. Send dashboard alert for each vote received
                 4. When RUNNING_VOTE_TOTAL >= ${QUORUM_THRESHOLD}:
                 - Send "Quorum Reached" dashboard alert
                 - Use calculate_winning_ratios tool with COLLECTED_VOTES array to determine winning ratios
                 - Use update_lynx_contract tool with winning ratios
                 - Send "Contract Updated" dashboard alert if successful
                 - Create token ratio snapshot and send to snapshot topic
                 - Send balancer alert about ratio updates

                 MEMORY TRACKING:
                 - Maintain RUNNING_VOTE_TOTAL: number (sum of all votingPower)
                 - Maintain COLLECTED_VOTES: MultiRatioVote[] (array of parsed vote objects)
                 - Reset both counters after successful governance round completion

                 AVAILABLE TOOLS:
                 - parse_hcs2_vote: Extract and validate vote data from raw HCS-2 topic messages
                 - calculate_winning_ratios: Process collected votes when quorum reached (takes MultiRatioVote[])
                 - update_lynx_contract: Update contract with winning token ratios
                 - create_token_snapshot: Create token ratio snapshot with proper hash and HCS-2 format
                 - submit_topic_message_tool: Send alerts to various topics

                Be precise, efficient, and provide clear status updates throughout the governance process.`],
                                ["user", "{input}"],
                                ["placeholder", "{agent_scratchpad}"],
            ]);

            const hederaTools = this.hederaAgentToolkit.getTools();
            const calculateWinningRatiosTool = new CalculateWinningRatiosTool();
            const updateContractTool = new UpdateLynxContractTool(this.client);
            const parseHCS2VoteTool = new ParseHCS2VoteTool();
            const createSnapshotTool = new CreateTokenSnapshotTool(this.client);
            const allTools = [...hederaTools, calculateWinningRatiosTool, updateContractTool, parseHCS2VoteTool, createSnapshotTool];

            const agent = await createToolCallingAgent({
                llm,
                tools: allTools,
                prompt
            });

            this.agentExecutor = new AgentExecutor({
                agent,
                tools: allTools,
                verbose: false,
                maxIterations: 10
            });
            
            console.log("✅ Lynx Governance Agent initialized");
        } catch (error) {
            console.error("❌ Error initializing Lynx Governance Agent:", error);
            throw error;
        }
    }

    async start(): Promise<void> {
        console.log("🚀 Starting Lynx Governance Agent");
        console.log("=================================");
        this.isRunning = true;

        if (!this.isRunning) {
            this.isRunning = true;

            process.on('SIGINT', async () => {
                console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
                await this.stop();
                process.exit(0);
            });
        }
        try {
            await this.startTopicListener();
        } catch (error) {
            console.error("❌ Error starting topic listener:", error);
            throw error;
        }
    }

    async stop(): Promise<void> {
        console.log("🛑 Stopping Lynx Governance Agent...");
        this.isRunning = false;
        console.log("✅ Lynx Governance Agent stopped");
    }

    private async startTopicListener(): Promise<void> {
        console.log("🔍 Starting topic listener for voting topic:", this.environment.CURRENT_ROUND_VOTING_TOPIC);
        if (!this.agentExecutor) {
            throw new Error("Agent executor not initialized");
        }

        const topicID = this.environment.CURRENT_ROUND_VOTING_TOPIC!;
        try {
            new TopicMessageQuery()
                .setTopicId(topicID)
                .setStartTime(new Date(Date.now()))
                .subscribe(
                    this.client!,
                    (message, error) => {
                        if (error) {
                          console.error("❌ Topic subscription error:", error);
                          return;
                        }
                    },
                    async (message) => {
                        if (!this.isRunning || !message) return;
                        try {
                            console.log("🚨 New topic message received!");
                            
                            // Parse and display vote details nicely
                            const rawMessage = Buffer.from(message.contents).toString("utf8");
                            try {
                                const hcs2Data = JSON.parse(rawMessage);
                                if (hcs2Data.p === 'hcs-2' && hcs2Data.metadata) {
                                    const voteData = JSON.parse(hcs2Data.metadata);
                                    console.log(`👤 Voter: ${voteData.voterAccountId}`);
                                    console.log(`⚡ Power: ${voteData.votingPower}`);
                                    console.log(`📊 Ratios: ${voteData.ratioChanges.map(r => `${r.token}(${r.newRatio}%)`).join(', ')}`);
                                    console.log(`💬 Reason: ${voteData.reason || 'No reason provided'}`);
                                } else {
                                    console.log(`📨 Raw: ${rawMessage.substring(0, 100)}...`);
                                }
                            } catch (parseError) {
                                console.log(`📨 Raw: ${rawMessage.substring(0, 100)}...`);
                            }
                            
                            console.log(`🕒 Time: ${new Date(message.consensusTimestamp.toDate()).toLocaleTimeString()}`);
                            await this.processTopicMessage(message);
                          } catch (error) {
                            console.error("❌ Error processing topic message:", error);
                          }
                    }
            );
        } catch (error) {
            console.error("❌ Error starting topic listener:", error);
            throw error;
        }
    }

    private async processTopicMessage(message: TopicMessage): Promise<void> {
        if (!this.agentExecutor) {
            throw new Error("Agent executor not initialized");
        }

        try {
            // Step 1: Parse the vote (simple LLM task)
            const rawMessageContent = Buffer.from(message.contents).toString("utf8");
            const vote = await this.parseVoteMessage(rawMessageContent);
            
            if (!vote) {
                console.log("❌ Failed to parse vote message");
                return;
            }
            
            // Step 2: JavaScript handles state management
            this.addVoteToState(vote);
            
            console.log(`🗳️  Vote processed. RUNNING_VOTE_TOTAL: ${this.currentVotingPower}/${QUORUM_THRESHOLD}`);
            
            // Step 3: JavaScript decides the flow
            if (this.currentVotingPower >= QUORUM_THRESHOLD) {
                console.log("🏛️ Quorum reached! Processing governance results...");
                await this.executeGovernanceFlow();
            } else {
                await this.sendDashboardAlert("Vote Confirmed: The vote has been confirmed.");
            }
            
        } catch (error) {
            console.error("❌ Error processing topic message:", error);
        }
    }

    private async parseVoteMessage(rawMessage: string): Promise<any> {
        try {
            const result = await this.agentExecutor!.invoke({
                input: `Use the parse_hcs2_vote tool to parse this HCS-2 message:

${rawMessage}

After using the tool, end your response with exactly:
VOTE_DATA: {the vote object from the tool result}

Example format:
VOTE_DATA: {"type":"MULTI_RATIO_VOTE","voterAccountId":"0.0.123","votingPower":100,"ratioChanges":[...],"timestamp":"2025-08-03T16:12:53.534Z","reason":"..."}`
            });
            
            // Extract vote data from the result
            const vote = this.extractVoteFromResult(result.output);
            return vote;
        } catch (error) {
            console.error("❌ Error parsing vote:", error);
            return null;
        }
    }

    private extractVoteFromResult(output: string): any {
        try {
            // Look for the VOTE_DATA: prefix that we asked the LLM to provide
            const voteDataMatch = output.match(/VOTE_DATA:\s*(\{.*\})/s);
            if (voteDataMatch) {
                const voteData = JSON.parse(voteDataMatch[1]);
                return voteData;
            }
            
            // Fallback: try to extract JSON from tool output if VOTE_DATA format wasn't used
            const jsonMatch = output.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                if (result.success && result.vote) {
                    return result.vote;
                } else {
                    console.error("❌ Parse tool failed:", result.error || 'Unknown error');
                    return null;
                }
            }
        } catch (error) {
            console.error("❌ Error extracting vote from result:", error);
        }
        return null;
    }

    private addVoteToState(vote: any): void {
        // Handle vote deduplication (latest vote per voter wins)
        const existingIndex = this.collectedVotes.findIndex(v => v.voterAccountId === vote.voterAccountId);
        if (existingIndex >= 0) {
            // Replace existing vote from same voter
            const oldVote = this.collectedVotes[existingIndex];
            this.currentVotingPower -= oldVote.votingPower;
            this.collectedVotes[existingIndex] = vote;
        } else {
            // New voter
            this.collectedVotes.push(vote);
        }
        this.currentVotingPower += vote.votingPower;
    }

    private async executeGovernanceFlow(): Promise<void> {
        console.log("🔄 Step 1: Sending quorum alert...");
        await this.sendDashboardAlert("Quorum Reached: Governance voting threshold has been met. Processing results...");
        
        console.log("🔄 Step 2: Calculating winning ratios...");
        const ratios = await this.calculateWinningRatios();
        
        if (ratios) {
            console.log("🔄 Step 3: Updating contract...");
            await this.updateContract(ratios);
            
            console.log("🔄 Step 4: Creating snapshot...");
            await this.createSnapshot(ratios);
            
            console.log("🔄 Step 5: Sending balancer alert...");
            await this.sendBalancerAlert();
            
            // Reset state for next round
            this.resetGovernanceState();
        }
    }

    private async calculateWinningRatios(): Promise<any> {
        try {
            const result = await this.agentExecutor!.invoke({
                input: `Analyze these collected votes and determine the winning ratios for each token.

Collected Votes (${this.collectedVotes.length} votes, ${this.currentVotingPower} total power):
${JSON.stringify(this.collectedVotes, null, 2)}

Rules:
- Latest vote per voter wins (handle any duplicates by timestamp)
- For each token, find the ratio that has the most voting power
- Return the winning ratios in this exact format:

WINNING_RATIOS: {"hbarRatio":X,"wbtcRatio":Y,"sauceRatio":Z,"usdcRatio":A,"jamRatio":B,"headstartRatio":C}

Where X,Y,Z,A,B,C are the winning ratio numbers for each token.`
            });
            
            return this.extractRatiosFromResult(result.output);
        } catch (error) {
            console.error("❌ Error calculating winning ratios:", error);
            return null;
        }
    }

    private extractRatiosFromResult(output: string): any {
        try {
            // Look for the WINNING_RATIOS: prefix that we asked the LLM to provide
            const winningRatiosMatch = output.match(/WINNING_RATIOS:\s*(\{.*\})/s);
            if (winningRatiosMatch) {
                const ratiosData = JSON.parse(winningRatiosMatch[1]);
                return ratiosData;
            }
            
            // Fallback: try to extract ratios from any JSON in the output
            const ratioMatch = output.match(/\{[\s\S]*?\}/);
            if (ratioMatch) {
                const parsed = JSON.parse(ratioMatch[0]);
                // Check if it looks like ratios (has the expected keys)
                if (parsed.hbarRatio !== undefined) {
                    return parsed;
                }
            }
        } catch (error) {
            console.error("❌ Error extracting ratios:", error);
        }
        return null;
    }

    private async updateContract(ratios: any): Promise<void> {
        try {
            await this.agentExecutor!.invoke({
                input: `Use the update_lynx_contract tool to update the contract with these winning ratios:

${JSON.stringify(ratios, null, 2)}

Update the contract and return the result.`
            });
            
            await this.sendDashboardAlert("Contract Updated: Token ratios have been successfully updated on the Lynx contract.");
        } catch (error) {
            console.error("❌ Error updating contract:", error);
        }
    }

    private async createSnapshot(ratios: any): Promise<void> {
        try {
            await this.agentExecutor!.invoke({
                input: `Use the create_token_snapshot tool to create a snapshot with these ratios:

Ratios: ${JSON.stringify(ratios, null, 2)}
Session ID: governance_round_${new Date().toISOString().split('T')[0]}
Created By: ${this.environment.HEDERA_ACCOUNT_ID}

Create and send the snapshot.`
            });
        } catch (error) {
            console.error("❌ Error creating snapshot:", error);
        }
    }

    private resetGovernanceState(): void {
        console.log("🔄 Resetting governance state for next round...");
        this.collectedVotes = [];
        this.currentVotingPower = 0;
    }





    private async sendBalancerAlert(): Promise<void> {
        if (!this.agentExecutor) {
            throw new Error("Agent executor not initialized");
        }
        
        try {
            const result = await this.agentExecutor.invoke({
                input: `CRITICAL: Use submit_topic_message_tool to send message to topic ${this.environment.BALANCER_ALERT_TOPIC} ONLY.

Message: "Balancer Alert: New token ratios have been updated."

Topic ID: ${this.environment.BALANCER_ALERT_TOPIC}

NEVER use voting topic ${this.environment.CURRENT_ROUND_VOTING_TOPIC}!`
            });

            console.log("⚖️ Balancer alert sent.");
        } catch (error) {
            console.error("❌ Error sending balancer alert:", error);
        }
    }

    private async sendDashboardAlert(message: string): Promise<void> {
        if (!this.agentExecutor) {
            throw new Error("Agent executor not initialized");
        }

        try {
            console.log(`📊 Sending dashboard alert to topic: ${this.environment.DASHBOARD_ALERT_TOPIC}`);
            
            const result = await this.agentExecutor.invoke({
                input: `CRITICAL: Use submit_topic_message_tool to send message to topic ${this.environment.DASHBOARD_ALERT_TOPIC} ONLY.

Message: "${message}"

Topic ID: ${this.environment.DASHBOARD_ALERT_TOPIC}

NEVER use voting topic ${this.environment.CURRENT_ROUND_VOTING_TOPIC} for alerts!`
            });

            console.log(`🔍 Dashboard alert result:`, result.output.substring(0, 200));

            console.log("📊 Dashboard alert sent.");
        } catch (error) {
            console.error("❌ Error sending dashboard alert:", error);
        }
    }
}