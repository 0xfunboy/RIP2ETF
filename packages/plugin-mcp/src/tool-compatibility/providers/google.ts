import { McpToolCompatibility, type ModelInfo } from '../index';

export class GoogleMcpCompatibility extends McpToolCompatibility {
  constructor(modelInfo: ModelInfo) {
    super(modelInfo);
  }

  shouldApply(): boolean {
    // Google models support schema properties but often ignore constraints
    // We need to embed constraints in descriptions for them to be respected
    return this.modelInfo.provider === 'google';
  }

  protected getUnsupportedStringProperties(): string[] {
    // Google models support these properties but often ignore them
    // So we move them to descriptions instead
    return ['minLength', 'maxLength', 'pattern', 'format'];
  }

  protected getUnsupportedNumberProperties(): string[] {
    // Google models support these but often ignore the constraints
    return ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];
  }

  protected getUnsupportedArrayProperties(): string[] {
    // Google models ignore array length constraints
    return ['minItems', 'maxItems', 'uniqueItems'];
  }

  protected getUnsupportedObjectProperties(): string[] {
    // Google models ignore object-level constraints
    return ['minProperties', 'maxProperties', 'additionalProperties'];
  }

  // Override to provide Google-optimized constraint descriptions
  protected mergeDescription(originalDescription: string | undefined, constraints: any): string {
    const constraintText = this.formatConstraintsForGoogle(constraints);
    if (originalDescription && constraintText) {
      return `${originalDescription}\n\nConstraints: ${constraintText}`;
    } else if (constraintText) {
      return `Constraints: ${constraintText}`;
    }
    return originalDescription || '';
  }

  private formatConstraintsForGoogle(constraints: any): string {
    const rules: string[] = [];
    
    // Format constraints in a way that Google models understand better
    if (constraints.minLength) {
      rules.push(`text must be at least ${constraints.minLength} characters long`);
    }
    if (constraints.maxLength) {
      rules.push(`text must be no more than ${constraints.maxLength} characters long`);
    }
    if (constraints.minimum !== undefined) {
      rules.push(`number must be at least ${constraints.minimum}`);
    }
    if (constraints.maximum !== undefined) {
      rules.push(`number must be no more than ${constraints.maximum}`);
    }
    if (constraints.exclusiveMinimum !== undefined) {
      rules.push(`number must be greater than ${constraints.exclusiveMinimum}`);
    }
    if (constraints.exclusiveMaximum !== undefined) {
      rules.push(`number must be less than ${constraints.exclusiveMaximum}`);
    }
    if (constraints.multipleOf) {
      rules.push(`number must be a multiple of ${constraints.multipleOf}`);
    }
    if (constraints.format === 'email') {
      rules.push(`must be a valid email address`);
    }
    if (constraints.format === 'uri' || constraints.format === 'url') {
      rules.push(`must be a valid URL starting with http:// or https://`);
    }
    if (constraints.format === 'uuid') {
      rules.push(`must be a valid UUID in the format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`);
    }
    if (constraints.format === 'date-time') {
      rules.push(`must be a valid ISO 8601 date-time (e.g., 2023-12-25T10:30:00Z)`);
    }
    if (constraints.pattern) {
      rules.push(`must match the regular expression pattern: ${constraints.pattern}`);
    }
    if (constraints.enum && Array.isArray(constraints.enum)) {
      rules.push(`must be exactly one of these values: ${constraints.enum.join(', ')}`);
    }
    if (constraints.minItems) {
      rules.push(`array must contain at least ${constraints.minItems} items`);
    }
    if (constraints.maxItems) {
      rules.push(`array must contain no more than ${constraints.maxItems} items`);
    }
    if (constraints.uniqueItems === true) {
      rules.push(`array items must all be unique (no duplicates)`);
    }
    if (constraints.minProperties) {
      rules.push(`object must have at least ${constraints.minProperties} properties`);
    }
    if (constraints.maxProperties) {
      rules.push(`object must have no more than ${constraints.maxProperties} properties`);
    }
    if (constraints.additionalProperties === false) {
      rules.push(`object must only contain the specified properties, no additional properties allowed`);
    }
    
    return rules.join('; ');
  }
} 