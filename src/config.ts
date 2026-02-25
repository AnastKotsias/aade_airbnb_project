import dotenv from 'dotenv';

dotenv.config();

// ===== Environment Configuration =====
export const ENV_MODE = (process.env.STAGEHAND_ENV || 'LOCAL') as 'LOCAL' | 'BROWSERBASE';
export const DRY_RUN = process.env.DRY_RUN !== 'false';
export const SLOW_MO_MS = 100; // Rate limiting: mimic human typing speeds

// ===== LLM Model Configuration =====
export const MODEL_CONFIG = {
  modelName: 'gpt-4o-mini' as const,
  provider: 'openai' as const,
  apiKey: process.env.OPENAI_API_KEY!,
};

// ===== Validation =====
export function validateEnv(requiredVars: string[]): void {
  if (!process.env.OPENAI_API_KEY) {
    console.error('\n❌ Missing OPENAI_API_KEY in .env file');
    console.error('💡 Get one at: https://platform.openai.com/api-keys\n');
    process.exit(1);
  }

  // Check other required vars
  const missing = requiredVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:');
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error('\n💡 Add them to your .env file.\n');
    process.exit(1);
  }

  console.log('🤖 Using: OpenAI (gpt-4o-mini)\n');
}
