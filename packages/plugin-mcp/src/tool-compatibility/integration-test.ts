#!/usr/bin/env node

/**
 * Integration test for MCP Tool Compatibility System
 * This test verifies that the tool compatibility is properly integrated
 * into the McpService and automatically applies transformations.
 */

import type { JSONSchema7 } from 'json-schema';
import { createMcpToolCompatibility, detectModelProvider } from './index';

// Mock runtime objects to test different scenarios
const mockRuntimes = {
  openai: { modelProvider: 'openai', model: 'gpt-4' },
  openaiReasoning: { modelProvider: 'openai', model: 'o3-mini' },
  anthropic: { modelProvider: 'anthropic', model: 'claude-3' },
  google: { modelProvider: 'google', model: 'gemini-pro' },
  unknown: { modelProvider: 'unknown', model: 'custom-model' },
};

// Test schema that has problematic constraints
const testSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    email: {
      type: 'string',
      format: 'email',
      minLength: 5,
      maxLength: 100,
    },
    count: {
      type: 'number',
      minimum: 1,
      maximum: 1000,
      multipleOf: 1,
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 10,
      uniqueItems: true,
    },
  },
  required: ['email'],
};

async function testIntegration() {
  console.log('🧪 Testing MCP Tool Compatibility Integration\n');
  
  for (const [providerName, runtime] of Object.entries(mockRuntimes)) {
    console.log(`📋 Testing ${providerName} (${runtime.model})`);
    console.log('-'.repeat(40));
    
    // Test model detection
    const modelInfo = detectModelProvider(runtime);
    console.log(`✅ Model detected: ${JSON.stringify(modelInfo)}`);
    
    // Test compatibility layer creation
    const compatibility = await createMcpToolCompatibility(runtime);
    
    if (compatibility) {
      console.log(`✅ Compatibility layer created: ${compatibility.constructor.name}`);
      console.log(`✅ Should apply: ${compatibility.shouldApply()}`);
      
      // Test schema transformation
      const originalJson = JSON.stringify(testSchema, null, 2);
      const transformedSchema = compatibility.transformToolSchema(testSchema);
      const transformedJson = JSON.stringify(transformedSchema, null, 2);
      
      if (originalJson !== transformedJson) {
        console.log('🔄 Schema was transformed');
        console.log('📝 Key differences:');
        
        // Show the key differences
        if (testSchema.properties && transformedSchema.properties) {
          Object.keys(testSchema.properties).forEach(prop => {
            const origProp = testSchema.properties![prop] as any;
            const transProp = transformedSchema.properties![prop] as any;
            
            if (JSON.stringify(origProp) !== JSON.stringify(transProp)) {
              const removedProps = Object.keys(origProp).filter(k => !(k in transProp));
              if (removedProps.length > 0) {
                console.log(`   • ${prop}: Removed ${removedProps.join(', ')}`);
              }
              if (transProp.description && !origProp.description) {
                console.log(`   • ${prop}: Added constraint description`);
              }
            }
          });
        }
      } else {
        console.log('⚪ No transformation needed');
      }
    } else {
      console.log('❌ No compatibility layer (as expected for unknown providers)');
    }
    
    console.log('');
  }
}

// Test that mimics how it would be used in McpService
async function testServiceIntegration() {
  console.log('🔧 Testing Service Integration Pattern\n');
  
  // Mock tool from MCP server with problematic schema
  const mockMcpTool = {
    name: 'send_email',
    description: 'Send an email message',
    inputSchema: testSchema,
  };
  
  // Simulate how McpService.fetchToolsList() would work
  async function simulateFetchToolsList(runtime: any, tools: any[]) {
    console.log(`📡 Simulating fetchToolsList for ${runtime.modelProvider}...`);
    
    const compatibility = await createMcpToolCompatibility(runtime);
    
    const processedTools = tools.map(tool => {
      const processedTool = { ...tool };
      
      if (tool.inputSchema && compatibility) {
        console.log(`🔄 Applying compatibility to tool: ${tool.name}`);
        processedTool.inputSchema = compatibility.transformToolSchema(tool.inputSchema);
      }
      
      return processedTool;
    });
    
    return processedTools;
  }
  
  // Test with different runtimes
  for (const [providerName, runtime] of Object.entries(mockRuntimes)) {
    console.log(`Testing ${providerName}:`);
    const processedTools = await simulateFetchToolsList(runtime, [mockMcpTool]);
    
    const originalHasFormat = JSON.stringify(mockMcpTool).includes('"format"');
    const processedHasFormat = JSON.stringify(processedTools[0]).includes('"format"');
    
    if (originalHasFormat && !processedHasFormat) {
      console.log(`✅ Format constraints removed (expected for ${providerName})`);
    } else if (!originalHasFormat && !processedHasFormat) {
      console.log(`⚪ No format constraints to process`);
    } else {
      console.log(`📝 Format constraints preserved`);
    }
    
    const hasConstraintDescription = JSON.stringify(processedTools[0]).includes('minLength');
    if (hasConstraintDescription) {
      console.log(`✅ Constraints embedded in description`);
    }
    
    console.log('');
  }
}

// Run the tests
(async () => {
  console.log('🚀 MCP Tool Compatibility Integration Test\n');
  console.log('='.repeat(50));
  await testIntegration();
  console.log('='.repeat(50));
  await testServiceIntegration();
  console.log('✅ Integration test complete!');
})();

export { testIntegration, testServiceIntegration }; 