import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';

export interface AdapterConfig {
  name: string;
  type: 'web' | 'cli';
  base_url?: string;
  login_detection?: string;
  input_selector: string;
  send_button: string;
  response_container: string;
  stream_detection?: string;
  pre_actions?: string[];
  features?: string[];
  notes?: string;
  // Alternative selectors for self-healing
  alternative_selectors?: {
    input_selector?: string[];
    send_button?: string[];
    response_container?: string[];
  };
}

/**
 * Load adapter configuration from YAML file
 */
export function loadAdapterConfig(modelId: string): AdapterConfig | null {
  const adapterPath = path.join(__dirname, `../adapters/${modelId}.yml`);
  
  if (!fs.existsSync(adapterPath)) {
    return null;
  }
  
  try {
    const yamlContent = fs.readFileSync(adapterPath, 'utf-8');
    return parseYaml(yamlContent) as AdapterConfig;
  } catch (error) {
    console.error(`Failed to load adapter for ${modelId}:`, error);
    return null;
  }
}

/**
 * Simple YAML parser (for basic key-value and nested structures)
 */
function parseYaml(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = content.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;
  let currentObject: Record<string, any> | null = null;
  let inMultilineString = false;
  let multilineKey: string | null = null;
  let multilineValue = '';

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    // Handle multiline string continuation
    if (inMultilineString && multilineKey) {
      if (line.startsWith('  ') || line.startsWith('\t')) {
        multilineValue += '\n' + line.trim();
        continue;
      } else {
        result[multilineKey] = multilineValue.trim();
        inMultilineString = false;
        multilineKey = null;
        multilineValue = '';
      }
    }

    // Check for array item
    if (line.trim().startsWith('- ')) {
      if (currentArray && currentKey) {
        currentArray.push(line.trim().substring(2));
        result[currentKey] = currentArray;
      }
      continue;
    }

    // Check for key-value pair
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      currentKey = key;
      currentArray = null;
      currentObject = null;

      if (value === '|' || value === '') {
        // Multiline string
        inMultilineString = true;
        multilineKey = key;
        multilineValue = '';
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // Inline array
        result[key] = value.slice(1, -1).split(',').map(s => s.trim());
        currentKey = null;
      } else if (value === '') {
        // Start of array or nested object
        currentArray = [];
        result[key] = currentArray;
      } else {
        // Simple value
        result[key] = parseValue(value);
        currentKey = null;
      }
    }
  }

  // Handle last multiline string
  if (inMultilineString && multilineKey) {
    result[multilineKey] = multilineValue.trim();
  }

  return result;
}

/**
 * Parse a YAML value to appropriate JavaScript type
 */
function parseValue(value: string): any {
  // Remove quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  // Null
  if (value.toLowerCase() === 'null' || value === '~') return null;

  // Number
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);

  return value;
}

/**
 * Find element using primary and alternative selectors (self-healing)
 */
export async function findElementWithFallback(
  page: Page,
  primarySelector: string,
  fallbackSelectors: string[] = []
): Promise<any> {
  const allSelectors = [primarySelector, ...fallbackSelectors];
  
  for (const selector of allSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        return element;
      }
    } catch (error) {
      // Continue to next selector
    }
  }
  
  throw new Error(`Element not found with any selector. Tried: ${allSelectors.join(', ')}`);
}

/**
 * Get all available adapters from the adapters directory
 */
export function getAvailableAdapters(): string[] {
  const adaptersDir = path.join(__dirname, '../adapters');
  
  if (!fs.existsSync(adaptersDir)) {
    return [];
  }
  
  const files = fs.readdirSync(adaptersDir);
  return files
    .filter(f => f.endsWith('.yml'))
    .map(f => f.replace('.yml', ''));
}

/**
 * Validate adapter configuration
 */
export function validateAdapter(config: AdapterConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!config.name) {
    errors.push('Missing required field: name');
  }
  
  if (!config.type || !['web', 'cli'].includes(config.type)) {
    errors.push('Invalid or missing type (must be "web" or "cli")');
  }
  
  if (config.type === 'web' && !config.base_url) {
    errors.push('Missing base_url for web adapter');
  }
  
  if (!config.input_selector) {
    errors.push('Missing required field: input_selector');
  }
  
  if (!config.send_button) {
    errors.push('Missing required field: send_button');
  }
  
  if (!config.response_container) {
    errors.push('Missing required field: response_container');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
