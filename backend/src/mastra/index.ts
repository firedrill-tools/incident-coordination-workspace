import { Mastra } from "@mastra/core/mastra";
import { createIncidentAgent, workspaceFile } from "./incident-agent.js";
import { Workspace } from "../state.js";
const incidentAgent = createIncidentAgent(new Workspace(workspaceFile()));

export const mastra = new Mastra({ agents: { incidentAgent } });
