import { Mastra } from "@mastra/core/mastra";
import { incidentAgent } from "./incident-agent.js";

export const mastra = new Mastra({ agents: { incidentAgent } });
