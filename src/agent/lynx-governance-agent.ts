import { config } from 'dotenv';
import { EnvironmentConfig } from './agent-env.js';
import { Client, TopicMessage, TopicMessageQuery, PrivateKey } from '@hashgraph/sdk';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { AgentMode, coreConsensusPlugin, coreQueriesPlugin, HederaLangchainToolkit } from 'hedera-agent-kit';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { TallyVoteTool } from '../tools/tally_vote.js';
import { UpdateLynxContractTool } from '../tools/update_lynx_contract.js';

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
            'OPENAI_KEY',
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
                apiKey: this.environment.OPENAI_KEY!,
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
                1. Parse incoming vote messages for votingPower and add to running total
                2. Send dashboard alert for each vote received
                3. When total voting power >= ${QUORUM_THRESHOLD}:
                - Send "Quorum Reached" dashboard alert
                - Use tally_vote tool to process all votes and determine winning ratios
                - Use update_lynx_contract tool with winning ratios
                - Send "Contract Updated" dashboard alert if successful
                - Create token ratio snapshot and send to snapshot topic
                - Send balancer alert about ratio updates

                MEMORY TRACKING:
                - Maintain RUNNING_VOTE_TOTAL in conversation memory
                - Collect all votes in COLLECTED_VOTES array for tallying
                - Reset counters after successful governance round completion

                AVAILABLE TOOLS:
                - tally_vote: Process collected votes when quorum reached
                - update_lynx_contract: Update contract with winning token ratios
                - submit_topic_message_tool: Send alerts to various topics

                Be precise, efficient, and provide clear status updates throughout the governance process.`],
                                ["user", "{input}"],
                                ["placeholder", "{agent_scratchpad}"],
            ]);

            const hederaTools = this.hederaAgentToolkit.getTools();
            const tallyVoteTool = new TallyVoteTool();
            const updateContractTool = new UpdateLynxContractTool(this.client);
            const allTools = [...hederaTools, tallyVoteTool, updateContractTool];

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
                            console.log(`📨 Message: ${Buffer.from(message.contents).toString("utf8")}`);
                            console.log(`🕒 Timestamp: ${new Date(message.consensusTimestamp.toDate())}`);
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
            const result = await this.agentExecutor.invoke({
                input: `Check the ${message} for the votingPower and add it to the total. If the total is greater than ${QUORUM_THRESHOLD}, then use the tally_vote tool for the quorum results.`
            });
            
            console.log("🔍 Agent result:", result);
            
            // Check if tally_votes returned results (quorum reached)
            if (result.output && result.output.includes('tokenResults')) {
                console.log("🏛️ Quorum reached! Processing governance results...");
                await this.sendDashboardAlert("Quorum Reached: Governance voting threshold has been met. Processing results...");
                await this.processGovernanceResults(result.output);
            }
            
            await this.sendDashboardAlert("Vote Confirmed: The vote has been confirmed.");
        } catch (error) {
            console.error("❌ Error processing topic message:", error);
        }
    }

    private async processGovernanceResults(tallyResults: string): Promise<void> {
        if (!this.agentExecutor) {
            throw new Error("Agent executor not initialized");
        }

        try {
            // Extract winning ratios and update contract
            const result = await this.agentExecutor.invoke({
                input: `Based on these tally results: ${tallyResults}, extract the winning ratios for each token and use the update_lynx_contract tool to update the contract with the new ratios.`
            });

            console.log("📋 Contract update result:", result);
            
            // Check if contract update was successful
            if (result.output && (result.output.includes('success') || result.output.includes('completed'))) {
                await this.sendDashboardAlert("Contract Updated: Token ratios have been successfully updated on the Lynx contract.");
            }
            
            await this.sendSnapshot(tallyResults);
            await this.sendBalancerAlert();
        } catch (error) {
            console.error("❌ Error processing governance results:", error);
        }
    }

    private async sendSnapshot(tallyResults: string): Promise<void> {
        if (!this.agentExecutor) {
            throw new Error("Agent executor not initialized");
        }
        
        try {
            const result = await this.agentExecutor.invoke({
                input: `Based on these tally results: ${tallyResults}, create a TokenRatioSnapshotData object with:
                - snapshot_id: "snapshot_" + current timestamp
                - snapshot_type: "token_ratios"  
                - governance_session: "governance_round_" + current date
                - token_weights: extract winning ratios from tally results as decimal percentages (e.g. 0.35 for 35%)
                - timestamp: current date
                - created_by: "${this.environment.HEDERA_ACCOUNT_ID}"
                - hash: SHA256 hash of the token_weights
                Then wrap it in HCS-2 format and use submit_topic_message_tool to send to ${this.environment.TOKEN_RATIO_SNAPSHOT_TOPIC}`
            });

            console.log("📸 Snapshot result:", result);
        } catch (error) {
            console.error("❌ Error sending token ratio snapshot:", error);
        }
    }

    private async sendBalancerAlert(): Promise<void> {
        if (!this.agentExecutor) {
            throw new Error("Agent executor not initialized");
        }
        
        try {
            const result = await this.agentExecutor.invoke({
                input: `Use the submit_topic_message_tool to submit an alert to the ${this.environment.BALANCER_ALERT_TOPIC} topic with the message "Balancer Alert: New token ratios have been updated."`
            });

            console.log("🔍 Agent result:", result);
        } catch (error) {
            console.error("❌ Error sending balancer alert:", error);
        }
    }

    private async sendDashboardAlert(message: string): Promise<void> {
        if (!this.agentExecutor) {
            throw new Error("Agent executor not initialized");
        }

        try {
            const result = await this.agentExecutor.invoke({
                input: `Use the submit_topic_message_tool to submit an alert to the ${this.environment.DASHBOARD_ALERT_TOPIC} topic with the message "${message}"`
            });

            console.log("📊 Dashboard alert sent:", result);
        } catch (error) {
            console.error("❌ Error sending dashboard alert:", error);
        }
    }
}