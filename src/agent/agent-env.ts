export interface EnvironmentConfig {
    HEDERA_NETWORK?: string;
    HEDERA_ACCOUNT_ID?: string;
    HEDERA_PRIVATE_KEY?: string;
    OPENAI_KEY?: string;
    LYNX_CONTRACT?: string;
    CURRENT_ROUND_VOTING_TOPIC?: string;
    TOKEN_RATIO_SNAPSHOT_TOPIC?: string;
    BALANCER_ALERT_TOPIC?: string;
    DASHBOARD_ALERT_TOPIC?: string;
}