import { McpToolCompatibility, type ModelInfo } from '../index';

export class OpenAIMcpCompatibility extends McpToolCompatibility {
  constructor(modelInfo: ModelInfo) {
    super(modelInfo);
  }

  shouldApply(): boolean {
    // Apply for OpenAI models that don't support structured outputs
    // or for reasoning models that need special handling
    return (
      this.modelInfo.provider === 'openai' &&
      (!this.modelInfo.supportsStructuredOutputs || this.modelInfo.isReasoningModel === true)
    );
  }

  protected getUnsupportedStringProperties(): string[] {
    const baseUnsupported = ['format']; // OpenAI models often reject format constraints
    
    // Reasoning models (o1, o3) have additional limitations
    if (this.modelInfo.isReasoningModel === true) {
      return [...baseUnsupported, 'pattern'];
    }
    
    // Some older OpenAI models don't handle regex patterns well
    if (this.modelInfo.modelId.includes('gpt-3.5') || this.modelInfo.modelId.includes('davinci')) {
      return [...baseUnsupported, 'pattern'];
    }
    
    return baseUnsupported;
  }

  protected getUnsupportedNumberProperties(): string[] {
    // Reasoning models have more limitations
    if (this.modelInfo.isReasoningModel === true) {
      return ['exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];
    }
    
    // Regular OpenAI models generally handle number constraints well
    return [];
  }

  protected getUnsupportedArrayProperties(): string[] {
    // Most OpenAI models handle array constraints well
    if (this.modelInfo.isReasoningModel === true) {
      return ['uniqueItems']; // Reasoning models may ignore uniqueItems
    }
    
    return [];
  }

  protected getUnsupportedObjectProperties(): string[] {
    // OpenAI models often ignore these object-level constraints
    return ['minProperties', 'maxProperties'];
  }
}

export class OpenAIReasoningMcpCompatibility extends McpToolCompatibility {
  constructor(modelInfo: ModelInfo) {
    super(modelInfo);
  }

  shouldApply(): boolean {
    return (
      this.modelInfo.provider === 'openai' &&
      this.modelInfo.isReasoningModel === true
    );
  }

  protected getUnsupportedStringProperties(): string[] {
    // Reasoning models are very strict - remove most constraints
    return ['format', 'pattern', 'minLength', 'maxLength'];
  }

  protected getUnsupportedNumberProperties(): string[] {
    // Keep only basic min/max, remove complex constraints
    return ['exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];
  }

  protected getUnsupportedArrayProperties(): string[] {
    // Remove array-specific constraints that reasoning models ignore
    return ['uniqueItems', 'minItems', 'maxItems'];
  }

  protected getUnsupportedObjectProperties(): string[] {
    // Remove all object-level constraints for reasoning models
    return ['minProperties', 'maxProperties', 'additionalProperties'];
  }

  // Override the mergeDescription for reasoning models to be more explicit
  protected mergeDescription(originalDescription: string | undefined, constraints: any): string {
    const constraintText = this.formatConstraintsForReasoningModel(constraints);
    if (originalDescription) {
      return `${originalDescription}\n\nIMPORTANT: ${constraintText}`;
    }
    return `IMPORTANT: ${constraintText}`;
  }

  private formatConstraintsForReasoningModel(constraints: any): string {
    const rules: string[] = [];
    
    if (constraints.minLength) {
      rules.push(`minimum ${constraints.minLength} characters`);
    }
    if (constraints.maxLength) {
      rules.push(`maximum ${constraints.maxLength} characters`);
    }
    if (constraints.minimum !== undefined) {
      rules.push(`must be >= ${constraints.minimum}`);
    }
    if (constraints.maximum !== undefined) {
      rules.push(`must be <= ${constraints.maximum}`);
    }
    if (constraints.format === 'email') {
      rules.push(`must be a valid email address`);
    }
    if (constraints.format === 'uri' || constraints.format === 'url') {
      rules.push(`must be a valid URL`);
    }
    if (constraints.format === 'uuid') {
      rules.push(`must be a valid UUID`);
    }
    if (constraints.pattern) {
      rules.push(`must match pattern: ${constraints.pattern}`);
    }
    if (constraints.enum) {
      rules.push(`must be one of: ${constraints.enum.join(', ')}`);
    }
    if (constraints.minItems) {
      rules.push(`array must have at least ${constraints.minItems} items`);
    }
    if (constraints.maxItems) {
      rules.push(`array must have at most ${constraints.maxItems} items`);
    }
    
    return rules.length > 0 ? rules.join(', ') : JSON.stringify(constraints);
  }
} 