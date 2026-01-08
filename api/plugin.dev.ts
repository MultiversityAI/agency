import "dotenv/config";

export default {
  pluginId: "api",
  port: 3014,
  config: {
    variables: {
      NEAR_AI_MODEL: process.env.NEAR_AI_MODEL || "deepseek-ai/DeepSeek-V3.1",
    },
    secrets: {
      API_DATABASE_URL: process.env.API_DATABASE_URL || "file:./database.db",
      API_DATABASE_AUTH_TOKEN: process.env.API_DATABASE_AUTH_TOKEN || "",
      NEAR_AI_API_KEY: process.env.NEAR_AI_API_KEY || "",
      NEAR_AI_BASE_URL: process.env.NEAR_AI_BASE_URL || "https://cloud-api.near.ai/v1",
    },
  },
};
