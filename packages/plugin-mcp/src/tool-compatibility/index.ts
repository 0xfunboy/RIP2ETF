import type { JSONSchema7 } from 'json-schema';

// Constraint types for embedding in descriptions
export interface StringConstraints {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  enum?: string[];
}

export interface NumberConstraints {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

export interface ArrayConstraints {
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

export interface ObjectConstraints {
  minProperties?: number;
  maxProperties?: number;
  additionalProperties?: boolean;
}

export type SchemaConstraints = StringConstraints | NumberConstraints | ArrayConstraints | ObjectConstraints;

// Model provider detection
export type ModelProvider = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'unknown';

export interface ModelInfo {
  provider: ModelProvider;
  modelId: string;
  supportsStructuredOutputs?: boolean;
  isReasoningModel?: boolean;
}

// Abstract base class for tool compatibility
export abstract class McpToolCompatibility {
  protected modelInfo: ModelInfo;

  constructor(modelInfo: ModelInfo) {
    this.modelInfo = modelInfo;
  }

  // Determine if this compatibility layer should be applied
  abstract shouldApply(): boolean;

  // Transform a complete tool schema
  public transformToolSchema(toolSchema: JSONSchema7): JSONSchema7 {
    if (!this.shouldApply()) {
      return toolSchema;
    }

    return this.processSchema(toolSchema);
  }

  // Process any JSON schema recursively
  protected processSchema(schema: JSONSchema7): JSONSchema7 {
    const processed = { ...schema };

    // Handle different schema types
    switch (processed.type) {
      case 'string':
        return this.processStringSchema(processed);
      case 'number':
      case 'integer':
        return this.processNumberSchema(processed);
      case 'array':
        return this.processArraySchema(processed);
      case 'object':
        return this.processObjectSchema(processed);
      default:
        return this.processGenericSchema(processed);
    }
  }

  // String schema processing
  protected processStringSchema(schema: JSONSchema7): JSONSchema7 {
    const constraints: StringConstraints = {};
    const processed = { ...schema };

    // Extract constraints that might not be supported
    if (typeof schema.minLength === 'number') {
      constraints.minLength = schema.minLength;
    }
    if (typeof schema.maxLength === 'number') {
      constraints.maxLength = schema.maxLength;
    }
    if (typeof schema.pattern === 'string') {
      constraints.pattern = schema.pattern;
    }
    if (typeof schema.format === 'string') {
      constraints.format = schema.format;
    }
    if (Array.isArray(schema.enum)) {
      constraints.enum = schema.enum as string[];
    }

    // Remove unsupported properties and embed in description
    const unsupportedProps = this.getUnsupportedStringProperties();
    for (const prop of unsupportedProps) {
      if (prop in processed) {
        delete (processed as any)[prop];
      }
    }

    // Embed constraints in description if any were found
    if (Object.keys(constraints).length > 0) {
      processed.description = this.mergeDescription(schema.description, constraints);
    }

    return processed;
  }

  // Number schema processing
  protected processNumberSchema(schema: JSONSchema7): JSONSchema7 {
    const constraints: NumberConstraints = {};
    const processed = { ...schema };

    // Extract numerical constraints
    if (typeof schema.minimum === 'number') {
      constraints.minimum = schema.minimum;
    }
    if (typeof schema.maximum === 'number') {
      constraints.maximum = schema.maximum;
    }
    if (typeof schema.exclusiveMinimum === 'number') {
      constraints.exclusiveMinimum = schema.exclusiveMinimum;
    }
    if (typeof schema.exclusiveMaximum === 'number') {
      constraints.exclusiveMaximum = schema.exclusiveMaximum;
    }
    if (typeof schema.multipleOf === 'number') {
      constraints.multipleOf = schema.multipleOf;
    }

    // Remove unsupported properties
    const unsupportedProps = this.getUnsupportedNumberProperties();
    for (const prop of unsupportedProps) {
      if (prop in processed) {
        delete (processed as any)[prop];
      }
    }

    // Embed constraints in description
    if (Object.keys(constraints).length > 0) {
      processed.description = this.mergeDescription(schema.description, constraints);
    }

    return processed;
  }

  // Array schema processing
  protected processArraySchema(schema: JSONSchema7): JSONSchema7 {
    const constraints: ArrayConstraints = {};
    const processed = { ...schema };

    // Extract array constraints
    if (typeof schema.minItems === 'number') {
      constraints.minItems = schema.minItems;
    }
    if (typeof schema.maxItems === 'number') {
      constraints.maxItems = schema.maxItems;
    }
    if (typeof schema.uniqueItems === 'boolean') {
      constraints.uniqueItems = schema.uniqueItems;
    }

    // Process items schema recursively
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      processed.items = this.processSchema(schema.items as JSONSchema7);
    }

    // Remove unsupported properties
    const unsupportedProps = this.getUnsupportedArrayProperties();
    for (const prop of unsupportedProps) {
      if (prop in processed) {
        delete (processed as any)[prop];
      }
    }

    // Embed constraints in description
    if (Object.keys(constraints).length > 0) {
      processed.description = this.mergeDescription(schema.description, constraints);
    }

    return processed;
  }

  // Object schema processing
  protected processObjectSchema(schema: JSONSchema7): JSONSchema7 {
    const constraints: ObjectConstraints = {};
    const processed = { ...schema };

    // Extract object constraints
    if (typeof schema.minProperties === 'number') {
      constraints.minProperties = schema.minProperties;
    }
    if (typeof schema.maxProperties === 'number') {
      constraints.maxProperties = schema.maxProperties;
    }
    if (typeof schema.additionalProperties === 'boolean') {
      constraints.additionalProperties = schema.additionalProperties;
    }

    // Process properties recursively
    if (schema.properties && typeof schema.properties === 'object') {
      processed.properties = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (typeof prop === 'object' && !Array.isArray(prop)) {
          processed.properties[key] = this.processSchema(prop as JSONSchema7);
        } else {
          processed.properties[key] = prop;
        }
      }
    }

    // Remove unsupported properties
    const unsupportedProps = this.getUnsupportedObjectProperties();
    for (const prop of unsupportedProps) {
      if (prop in processed) {
        delete (processed as any)[prop];
      }
    }

    // Embed constraints in description
    if (Object.keys(constraints).length > 0) {
      processed.description = this.mergeDescription(schema.description, constraints);
    }

    return processed;
  }

  // Generic schema processing (for union types, etc.)
  protected processGenericSchema(schema: JSONSchema7): JSONSchema7 {
    const processed = { ...schema };

    // Handle oneOf, anyOf, allOf recursively
    if (Array.isArray(schema.oneOf)) {
      processed.oneOf = schema.oneOf.map(s => typeof s === 'object' ? this.processSchema(s as JSONSchema7) : s);
    }
    if (Array.isArray(schema.anyOf)) {
      processed.anyOf = schema.anyOf.map(s => typeof s === 'object' ? this.processSchema(s as JSONSchema7) : s);
    }
    if (Array.isArray(schema.allOf)) {
      processed.allOf = schema.allOf.map(s => typeof s === 'object' ? this.processSchema(s as JSONSchema7) : s);
    }

    return processed;
  }

  // Merge constraints into description
  protected mergeDescription(originalDescription: string | undefined, constraints: SchemaConstraints): string {
    const constraintJson = JSON.stringify(constraints);
    if (originalDescription) {
      return `${originalDescription}\n${constraintJson}`;
    }
    return constraintJson;
  }

  // Abstract methods that subclasses must implement
  protected abstract getUnsupportedStringProperties(): string[];
  protected abstract getUnsupportedNumberProperties(): string[];
  protected abstract getUnsupportedArrayProperties(): string[];
  protected abstract getUnsupportedObjectProperties(): string[];
}

// Model detection utilities
export function detectModelProvider(runtime: any): ModelInfo {
  // Try to extract model info from ElizaOS runtime
  const modelString = runtime?.modelProvider || runtime?.model || '';
  const modelId = String(modelString).toLowerCase();

  let provider: ModelProvider = 'unknown';
  let supportsStructuredOutputs = false;
  let isReasoningModel = false;

  // Detect provider based on model string
  if (modelId.includes('openai') || modelId.includes('gpt-') || modelId.includes('o1-') || modelId.includes('o3-')) {
    provider = 'openai';
    supportsStructuredOutputs = modelId.includes('gpt-4') || modelId.includes('o1') || modelId.includes('o3');
    isReasoningModel = modelId.includes('o1') || modelId.includes('o3');
  } else if (modelId.includes('anthropic') || modelId.includes('claude')) {
    provider = 'anthropic';
    supportsStructuredOutputs = true;
  } else if (modelId.includes('google') || modelId.includes('gemini')) {
    provider = 'google';
    supportsStructuredOutputs = true;
  } else if (modelId.includes('openrouter')) {
    provider = 'openrouter';
    // OpenRouter depends on the underlying model
    supportsStructuredOutputs = false;
  }

  return {
    provider,
    modelId,
    supportsStructuredOutputs,
    isReasoningModel,
  };
}

// Factory function to get the appropriate compatibility layer
export async function createMcpToolCompatibility(runtime: any): Promise<McpToolCompatibility | null> {
  const modelInfo = detectModelProvider(runtime);
  
  // Import and instantiate the appropriate compatibility layer
  try {
    switch (modelInfo.provider) {
      case 'openai':
        // Use dynamic ES module imports
        const { OpenAIMcpCompatibility } = await import('./providers/openai.js');
        return new OpenAIMcpCompatibility(modelInfo);
      case 'anthropic':
        const { AnthropicMcpCompatibility } = await import('./providers/anthropic.js');
        return new AnthropicMcpCompatibility(modelInfo);
      case 'google':
        const { GoogleMcpCompatibility } = await import('./providers/google.js');
        return new GoogleMcpCompatibility(modelInfo);
      default:
        return null; // No compatibility layer needed
    }
  } catch (error) {
    console.warn('Failed to load compatibility provider:', error);
    return null;
  }
}

// Synchronous version for environments that need it (like service.ts)
export function createMcpToolCompatibilitySync(runtime: any): McpToolCompatibility | null {
  const modelInfo = detectModelProvider(runtime);
  
  // Use synchronous requires for CommonJS environments
  try {
    switch (modelInfo.provider) {
      case 'openai':
        // Use eval to avoid bundlers trying to process this
        const OpenAIModule = eval('require')('./providers/openai');
        const { OpenAIMcpCompatibility } = OpenAIModule;
        return new OpenAIMcpCompatibility(modelInfo);
      case 'anthropic':
        const AnthropicModule = eval('require')('./providers/anthropic');
        const { AnthropicMcpCompatibility } = AnthropicModule;
        return new AnthropicMcpCompatibility(modelInfo);
      case 'google':
        const GoogleModule = eval('require')('./providers/google');
        const { GoogleMcpCompatibility } = GoogleModule;
        return new GoogleMcpCompatibility(modelInfo);
      default:
        return null; // No compatibility layer needed
    }
  } catch (error) {
    console.warn('Failed to load compatibility provider:', error);
    return null;
  }
} 