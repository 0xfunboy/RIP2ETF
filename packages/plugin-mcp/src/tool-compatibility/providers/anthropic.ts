import { McpToolCompatibility, type ModelInfo } from '../index';

export class AnthropicMcpCompatibility extends McpToolCompatibility {
  constructor(modelInfo: ModelInfo) {
    super(modelInfo);
  }

  shouldApply(): boolean {
    // Anthropic models generally handle JSON schema well, but we still
    // apply light compatibility for edge cases
    return this.modelInfo.provider === 'anthropic';
  }

  protected getUnsupportedStringProperties(): string[] {
    // Anthropic models handle most string constraints well
    // Only remove very specific edge cases
    return [];
  }

  protected getUnsupportedNumberProperties(): string[] {
    // Anthropic models handle number constraints very well
    return [];
  }

  protected getUnsupportedArrayProperties(): string[] {
    // Anthropic models handle array constraints well
    return [];
  }

  protected getUnsupportedObjectProperties(): string[] {
    // Anthropic models handle object constraints reasonably well
    // Only remove constraints that are commonly ignored
    return ['additionalProperties'];
  }

  // Override to provide a cleaner description format for Anthropic
  protected mergeDescription(originalDescription: string | undefined, constraints: any): string {
    // Since Anthropic handles most constraints natively, we use a lighter touch
    const constraintHints = this.formatConstraintsForAnthropic(constraints);
    if (originalDescription && constraintHints) {
      return `${originalDescription}. ${constraintHints}`;
    } else if (constraintHints) {
      return constraintHints;
    }
    return originalDescription || '';
  }

  private formatConstraintsForAnthropic(constraints: any): string {
    const hints: string[] = [];
    
    // Only add hints for constraints that might benefit from clarification
    if (constraints.additionalProperties === false) {
      hints.push('Only use the specified properties');
    }
    if (constraints.format === 'date-time') {
      hints.push('Use ISO 8601 date-time format');
    }
    if (constraints.pattern) {
      hints.push(`Must match the pattern: ${constraints.pattern}`);
    }
    
    return hints.join('. ');
  }
} 