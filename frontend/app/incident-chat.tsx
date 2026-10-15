"use client";

import { CopilotChat, CopilotChatAssistantMessage, useAgent } from "@copilotkit/react-core/v2";
import { useEffect, useState, type ComponentProps } from "react";
import { defaultRehypePlugins } from "streamdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";

// Sanitize source HTML before the trusted math renderer generates its markup.
// Retain Streamdown's URL hardening after rendering.
const markdownPlugins: ComponentProps<typeof CopilotChatAssistantMessage.MarkdownRenderer>["rehypePlugins"] = [
  defaultRehypePlugins.raw,
  [rehypeSanitize, { ...defaultSchema, attributes: { ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]] } }],
  [rehypeKatex, { trust: false, errorColor: "var(--color-muted-foreground)" }],
  defaultRehypePlugins.harden,
];

export function IncidentChat() {
  const { agent, isReady } = useAgent({ agentId: "incident-agent" });
  const [error, setError] = useState("");
  useEffect(() => {
    const subscription = agent.subscribe({ onRunInitialized: () => { setError(""); } });
    return () => subscription.unsubscribe();
  }, [agent]);

  return <>
    {!isReady && <p role="status">Connecting to the incident agent…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {isReady && <CopilotChat agentId="incident-agent" className="chat"
      messageView={{ assistantMessage: { markdownRenderer: { rehypePlugins: markdownPlugins } } }} onError={() => {
      setError("Incident copilot could not complete this request. Check the agent service or provider configuration before retrying.");
    }} />}
  </>;
}
