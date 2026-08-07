import type { Config } from '../config.js';
import { MockProvider } from './mock.js';
import { PlaidProvider } from './plaid.js';
import type { FinancialDataProvider } from './types.js';

export { MockProvider, seedDemoScenario } from './mock.js';
export { PlaidProvider } from './plaid.js';
export * from './types.js';

export function createProvider(config: Config): FinancialDataProvider {
  switch (config.provider) {
    case 'plaid':
      return new PlaidProvider(config);
    case 'mock':
      return new MockProvider();
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unsupported provider: ${String(exhaustive)}`);
    }
  }
}
