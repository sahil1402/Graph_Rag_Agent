const state = {
  currentPayload: null,
};

const elements = {
  commandInput: document.getElementById("commandInput"),
  runButton: document.getElementById("runButton"),
  resetButton: document.getElementById("resetButton"),
  statusMessage: document.getElementById("statusMessage"),
  nodeCount: document.getElementById("nodeCount"),
  edgeCount: document.getElementById("edgeCount"),
  runStatus: document.getElementById("runStatus"),
  taskSummary: document.getElementById("taskSummary"),
  browserTitle: document.getElementById("browserTitle"),
  browserSummary: document.getElementById("browserSummary"),
  browserElements: document.getElementById("browserElements"),
  stepList: document.getElementById("stepList"),
  stepCountBadge: document.getElementById("stepCountBadge"),
  graphCanvas: document.getElementById("graphCanvas"),
  exampleButtons: document.getElementById("exampleButtons"),
  intentBadge: document.getElementById("intentBadge"),
};

async function loadState() {
  const response = await fetch("/api/state");
  const payload = await response.json();
  state.currentPayload = payload;
  render(payload);
}

async function runCommand() {
  const command = elements.commandInput.value.trim();
  if (!command) {
    elements.statusMessage.textContent = "Type a command first so the agent has something to do.";
    return;
  }

  setBusy(true, "Running the GraphRAG agent...");
  const response = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
  const payload = await response.json();
  setBusy(false, payload.error || "Run complete.");
  state.currentPayload = payload;
  render(payload);
}

async function resetMemory() {
  setBusy(true, "Resetting graph memory...");
  const response = await fetch("/api/reset-memory", { method: "POST" });
  const payload = await response.json();
  setBusy(false, "Graph memory reset.");
  state.currentPayload = payload;
  render(payload);
}

function setBusy(isBusy, message) {
  elements.runButton.disabled = isBusy;
  elements.resetButton.disabled = isBusy;
  elements.statusMessage.textContent = message;
}

function render(payload) {
  const memoryStats = payload.memory_stats || { node_count: 0, edge_count: 0 };
  elements.nodeCount.textContent = String(memoryStats.node_count ?? 0);
  elements.edgeCount.textContent = String(memoryStats.edge_count ?? 0);

  const lastRun = payload.report ? payload : payload.last_run;
  const examples = payload.examples || [];
  renderExamples(examples);

  if (!lastRun) {
    elements.runStatus.textContent = "Ready";
    elements.intentBadge.textContent = "Idle";
    elements.taskSummary.textContent = "Run a command to see the parsed intent and task fields.";
    elements.browserTitle.textContent = "No run yet";
    elements.browserSummary.textContent = "The final observed page and visible elements will appear here.";
    elements.browserElements.innerHTML = "";
    elements.stepList.textContent = "No run yet. The trace will show how the agent used graph memory to choose actions.";
    elements.stepCountBadge.textContent = "0 steps";
    renderGraph(payload.graph || { nodes: [], edges: [] }, [], []);
    return;
  }

  const report = lastRun.report || {};
  const finalObservation = report.final_observation || null;
  const success = Boolean(report.success);
  elements.runStatus.textContent = success ? "Success" : "Needs Review";
  elements.intentBadge.textContent = formatIntent(lastRun.parsed_intent || "run");

  renderTask(lastRun.task || {}, lastRun.parser_explanation || "");
  renderBrowser(finalObservation);
  renderSteps(report.steps || []);
  renderGraph(
    lastRun.graph || payload.graph || { nodes: [], edges: [] },
    lastRun.highlighted_edge_ids || [],
    lastRun.highlighted_node_ids || [],
  );
}

function renderExamples(examples) {
  elements.exampleButtons.innerHTML = "";
  examples.forEach((example) => {
    const button = document.createElement("button");
    button.className = "example-button";
    button.textContent = example;
    button.addEventListener("click", () => {
      elements.commandInput.value = example;
    });
    elements.exampleButtons.appendChild(button);
  });
}

function renderTask(task, explanation) {
  const wrapper = document.createElement("div");
  wrapper.className = "task-summary";

  const goal = document.createElement("div");
  goal.innerHTML = `<strong>Goal</strong><div>${escapeHtml(task.goal || "Unknown")}</div>`;
  wrapper.appendChild(goal);

  const successScreen = document.createElement("div");
  successScreen.innerHTML = `<strong>Target Screen</strong><div>${escapeHtml(task.success_screen_id || "Unknown")}</div>`;
  wrapper.appendChild(successScreen);

  const pills = document.createElement("div");
  pills.className = "task-pills";
  const inputs = task.required_inputs || {};
  const entries = Object.entries(inputs);
  if (entries.length === 0) {
    const pill = document.createElement("span");
    pill.className = "task-pill";
    pill.textContent = "No required form inputs";
    pills.appendChild(pill);
  } else {
    entries.forEach(([key, value]) => {
      const pill = document.createElement("span");
      pill.className = "task-pill";
      pill.textContent = `${key}: ${value}`;
      pills.appendChild(pill);
    });
  }
  wrapper.appendChild(pills);

  const parser = document.createElement("div");
  parser.innerHTML = `<strong>Parser</strong><div>${escapeHtml(explanation || "Heuristic parser")}</div>`;
  wrapper.appendChild(parser);

  elements.taskSummary.innerHTML = "";
  elements.taskSummary.appendChild(wrapper);
}

function renderBrowser(finalObservation) {
  if (!finalObservation) {
    elements.browserTitle.textContent = "No final observation";
    elements.browserSummary.textContent = "The browser state will appear here after the first run.";
    elements.browserElements.innerHTML = "";
    return;
  }

  elements.browserTitle.textContent = finalObservation.screen_label || "Unknown screen";
  elements.browserSummary.textContent = finalObservation.text_summary || "";
  elements.browserElements.innerHTML = "";

  const visualTag = document.createElement("span");
  visualTag.className = "visible-tag";
  visualTag.textContent = finalObservation.visual_summary || "No visual summary";
  elements.browserElements.appendChild(visualTag);

  (finalObservation.elements || []).forEach((element) => {
    const chip = document.createElement("div");
    chip.className = "browser-chip";
    chip.innerHTML = `
      <strong>${escapeHtml(element.label)}</strong>
      <small>${escapeHtml(element.role)}${element.value ? ` · value: ${escapeHtml(element.value)}` : ""}</small>
    `;
    elements.browserElements.appendChild(chip);
  });
}

function renderSteps(steps) {
  elements.stepList.innerHTML = "";
  elements.stepCountBadge.textContent = `${steps.length} step${steps.length === 1 ? "" : "s"}`;
  if (steps.length === 0) {
    elements.stepList.textContent = "No execution trace available yet.";
    return;
  }

  steps.forEach((step) => {
    const card = document.createElement("article");
    card.className = "step-card";
    const retrieval = (step.retrieval_lines || []).slice(0, 3).map(escapeHtml).join("<br>");
    const visible = (step.visible_elements || []).map((item) => `<span class="task-pill">${escapeHtml(item)}</span>`).join("");
    card.innerHTML = `
      <div class="step-topline">
        <div>
          <small>Step ${step.step_number}</small>
          <h3>${escapeHtml(step.observation_label)}</h3>
        </div>
        <span class="intent-badge neutral-badge">${escapeHtml(step.action.kind)}${step.action.target_id ? ` → ${escapeHtml(step.action.target_id)}` : ""}</span>
      </div>
      <div>${escapeHtml(step.observation_summary)}</div>
      <div class="step-details">
        <span class="task-pill"><strong>Why</strong>&nbsp;${escapeHtml(step.action_reason || step.action.reason || "")}</span>
        <span class="task-pill"><strong>Result</strong>&nbsp;${escapeHtml(step.result_message)}</span>
      </div>
      <div class="step-details">${visible}</div>
      <div class="step-details"><span class="task-pill"><strong>Graph context</strong>&nbsp;${escapeHtml(step.context_summary)}</span></div>
      ${retrieval ? `<div class="step-details"><span class="task-pill"><strong>Retrieved</strong>&nbsp;<span>${retrieval}</span></span></div>` : ""}
    `;
    elements.stepList.appendChild(card);
  });
}

function renderGraph(graph, highlightedEdgeIds, highlightedNodeIds) {
  const svg = elements.graphCanvas;
  svg.innerHTML = `
    <defs>
      <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="rgba(255,255,255,0.45)"></polygon>
      </marker>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="blur"></feGaussianBlur>
        <feMerge>
          <feMergeNode in="blur"></feMergeNode>
          <feMergeNode in="SourceGraphic"></feMergeNode>
        </feMerge>
      </filter>
    </defs>
  `;

  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  if (nodes.length === 0) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "50%");
    text.setAttribute("y", "50%");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "graph-empty");
    text.textContent = "Run the agent to build the graph memory.";
    svg.appendChild(text);
    return;
  }

  const screenNodes = nodes.filter((node) => node.type === "screen");
  const elementNodes = nodes.filter((node) => node.type !== "screen");
  const positioned = new Map();

  placeColumn(screenNodes, 200, 70, 450, positioned);
  placeColumn(elementNodes, 500, 70, 450, positioned);

  edges.forEach((edge) => {
    const source = positioned.get(edge.source);
    const target = positioned.get(edge.target);
    if (!source || !target) {
      return;
    }
    const isHighlighted = highlightedEdgeIds.includes(edge.id);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(source.x));
    line.setAttribute("y1", String(source.y));
    line.setAttribute("x2", String(target.x));
    line.setAttribute("y2", String(target.y));
    line.setAttribute("stroke", edgeStroke(edge.relation, isHighlighted));
    line.setAttribute("stroke-width", isHighlighted ? "3.4" : edgeWidth(edge.weight));
    line.setAttribute("stroke-opacity", isHighlighted ? "0.95" : "0.48");
    line.setAttribute("marker-end", "url(#arrowhead)");
    if (isHighlighted) {
      line.setAttribute("filter", "url(#glow)");
    }
    svg.appendChild(line);
  });

  nodes.forEach((node) => {
    const position = positioned.get(node.id);
    if (!position) {
      return;
    }
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const highlighted = highlightedNodeIds.includes(node.id);
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(position.x - 74));
    rect.setAttribute("y", String(position.y - 28));
    rect.setAttribute("width", "148");
    rect.setAttribute("height", "56");
    rect.setAttribute("rx", "18");
    rect.setAttribute("fill", node.type === "screen" ? "rgba(76, 201, 240, 0.14)" : "rgba(255, 209, 102, 0.12)");
    rect.setAttribute("stroke", highlighted ? "rgba(255, 140, 66, 0.92)" : node.type === "screen" ? "rgba(76, 201, 240, 0.55)" : "rgba(255, 209, 102, 0.55)");
    rect.setAttribute("stroke-width", highlighted ? "2.8" : "1.4");
    if (highlighted) {
      rect.setAttribute("filter", "url(#glow)");
    }

    const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
    title.setAttribute("x", String(position.x));
    title.setAttribute("y", String(position.y - 4));
    title.setAttribute("text-anchor", "middle");
    title.setAttribute("fill", "#eef6fb");
    title.setAttribute("font-size", "12");
    title.setAttribute("font-weight", "700");
    title.textContent = shorten(node.label, 18);

    const subtitle = document.createElementNS("http://www.w3.org/2000/svg", "text");
    subtitle.setAttribute("x", String(position.x));
    subtitle.setAttribute("y", String(position.y + 12));
    subtitle.setAttribute("text-anchor", "middle");
    subtitle.setAttribute("fill", "rgba(238, 246, 251, 0.75)");
    subtitle.setAttribute("font-size", "10");
    subtitle.textContent = node.type;

    group.appendChild(rect);
    group.appendChild(title);
    group.appendChild(subtitle);
    svg.appendChild(group);
  });
}

function placeColumn(nodes, x, top, height, positioned) {
  if (nodes.length === 0) {
    return;
  }
  const gap = nodes.length === 1 ? 0 : height / (nodes.length - 1);
  nodes.forEach((node, index) => {
    positioned.set(node.id, {
      x,
      y: top + gap * index,
    });
  });
}

function edgeStroke(relation, highlighted) {
  if (highlighted) {
    return "rgba(255, 140, 66, 0.98)";
  }
  if (relation === "leads_to") {
    return "rgba(255, 159, 67, 0.68)";
  }
  if (relation === "clicked") {
    return "rgba(64, 196, 170, 0.62)";
  }
  if (relation === "filled") {
    return "rgba(76, 201, 240, 0.52)";
  }
  return "rgba(255,255,255,0.35)";
}

function edgeWidth(weight) {
  const value = Number(weight || 1);
  return String(Math.min(3, Math.max(1.2, value * 0.65)));
}

function formatIntent(intent) {
  return intent
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function shorten(value, maxLength) {
  if (!value) {
    return "";
  }
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

elements.runButton.addEventListener("click", runCommand);
elements.resetButton.addEventListener("click", resetMemory);
elements.commandInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    runCommand();
  }
});

loadState().catch((error) => {
  elements.statusMessage.textContent = `Failed to load app state: ${error}`;
});
