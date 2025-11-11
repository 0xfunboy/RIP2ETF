export const toolSelectionNameSchema = {
  type: "object",
  required: ["serverName", "toolName"],
  properties: {
    serverName: {
      type: "string",
      minLength: 1,
      errorMessage: "serverName must not be empty",
    },
    toolName: {
      type: "string",
      minLength: 1,
      errorMessage: "toolName must not be empty",
    },
    reasoning: {
      type: "string",
    },
    noToolAvailable: {
      type: "boolean",
    },
  },
};

export interface ToolSelectionName {
  serverName: string;
  toolName: string;
  reasoning?: string;
  noToolAvailable?: boolean;
}

export const toolSelectionArgumentSchema = {
  type: "object",
  required: ["toolArguments"],
  properties: {
    toolArguments: {
      type: "object",
    },
  },
};

export interface ToolSelectionArgument {
  toolArguments: Record<string, unknown>;
}

export const ResourceSelectionSchema = {
  type: "object",
  required: ["serverName", "uri"],
  properties: {
    serverName: {
      type: "string",
      minLength: 1,
      errorMessage: "serverName must not be empty",
    },
    uri: {
      type: "string",
      minLength: 1,
      errorMessage: "uri must not be empty",
    },
    reasoning: {
      type: "string",
    },
    noResourceAvailable: {
      type: "boolean",
    },
  },
};

export interface ResourceSelection {
  serverName: string;
  uri: string;
  reasoning?: string;
  noResourceAvailable?: boolean;
}
