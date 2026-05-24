const state = {
  currentPayload: null,
  selectedStepIndex: 0,
  selectedNodeId: null,
};

const elements = {
  commandInput: document.getElementById("commandInput"),
  targetUrlInput: document.getElementById("targetUrlInput"),
  runButton: document.getElementById("runButton"),
  resetButton: document.getElementById("resetButton"),
  statusMessage: document.getElementById("statusMessage"),
  nodeCount: document.getElementById("nodeCount"),
  edgeCount: document.getElementById("edgeCount"),
  runStatus: document.getElementById("runStatus"),
  taskSummary: document.getElementById("taskSummary"),
  browserTitle: document.getElementById("browserTitle"),
  browserUrl: document.getElementById("browserUrl"),
  browserImage: document.getElementById("browserImage"),
  browserPlaceholder: document.getElementById("browserPlaceholder"),
  browserSummary: document.getElementById("browserSummary"),
  stepGallery: document.getElementById("stepGallery"),
  stepList: document.getElementById("stepList"),
  stepCountBadge: document.getElementById("stepCountBadge"),
  graphCanvas: document.getElementById("graphCanvas"),
  graphMeta: document.getElementById("graphMeta"),
  exampleButtons: document.getElementById("exampleButtons"),
  intentBadge: document.getElementById("intentBadge"),
};

async function loadState() {
  const response = await fetch("/api/state");
  const payload = await response.json();
  state.currentPayload = payload;
  if (!elements.targetUrlInput.value && payload.default_target_url) {
    elements.targetUrlInput.value = payload.default_target_url;
  }
  render(payload);
}

async function runCommand() {
  const command = elements.commandInput.value.trim();
  if (!command) {
    elements.statusMessage.textContent = "Type a command first so the browser agent has a job to do.";
    return;
  }

  setBusy(true, "Launching the browser agent...");
  const response = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command,
      target_url: elements.targetUrlInput.value.trim(),
    }),
  });

  const payload = await response.json();
  state.selectedStepIndex = Array.isArray(payload.report?.steps) ? payload.report.steps.length : 0;
  state.selectedNodeId = null;
  state.currentPayload = payload;
  setBusy(false, payload.error || "Run complete.");
  if (!response.ok) {
    render(payload);
    return;
  }
  render(payload);
}

async function resetMemory() {
  setBusy(true, "Resetting graph memory...");
  const response = await fetch("/api/reset-memory", { method: "POST" });
  const payload = await response.json();
  state.selectedStepIndex = 0;
  state.selectedNodeId = null;
  state.currentPayload = payload;
  setBusy(false, "Memory reset.");
  if (payload.default_target_url) {
    elements.targetUrlInput.value = payload.default_target_url;
  }
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
  renderExamples(payload.examples || []);

  const activePayload = payload.report ? payload : payload.last_run;
  if (!activePayload) {
    elements.runStatus.textContent = "Ready";
    elements.intentBadge.textContent = "Idle";
    elements.browserTitle.textContent = "No browser run yet";
    elements.browserUrl.textContent = payload.default_target_url || "Waiting for target URL";
    renderTask(null, payload.default_target_url || "");
    renderBrowser(null, null);
    renderStepGallery([]);
    renderSteps([]);
    renderGraph(payload.graph || { nodes: [], edges: [] }, [], []);
    return;
  }

  elements.runStatus.textContent = activePayload.report?.success ? "Success" : "Review";
  elements.intentBadge.textContent = formatIntent(activePayload.parsed_intent || "run");
  renderTask(activePayload, activePayload.target_url || payload.default_target_url || "");
  renderBrowser(activePayload.report || {}, activePayload.browser || {});
  renderStepGallery(activePayload.report?.steps || []);
  renderSteps(activePayload.report?.steps || []);
  renderGraph(
    activePayload.graph || payload.graph || { nodes: [], edges: [] },
    activePayload.highlighted_edge_ids || [],
    activePayload.highlighted_node_ids || [],
  );
}

function renderExamples(examples) {
  elements.exampleButtons.innerHTML = "";
  examples.forEach((example) => {
    const button = document.createElement("button");
    button.className = "example-chip";
    button.textContent = example;
    button.addEventListener("click", () => {
      elements.commandInput.value = example;
    });
    elements.exampleButtons.appendChild(button);
  });
}

function renderTask(payload, targetUrl) {
  if (!payload) {
    elements.taskSummary.textContent = "Run a command to see the parsed task, input hints, and target URL.";
    return;
  }

  const task = payload.task || {};
  const wrapper = document.createElement("div");
  wrapper.className = "task-summary";
  const hints = Object.entries(task.required_inputs || {});
  const pills = hints.length
    ? hints.map(([key, value]) => `<span class="pill">${escapeHtml(key)}: ${escapeHtml(value)}</span>`).join("")
    : `<span class="pill">No explicit input hints</span>`;

  wrapper.innerHTML = `
    <div><strong>Intent</strong><div>${escapeHtml(formatIntent(payload.parsed_intent || "run"))}</div></div>
    <div><strong>Goal</strong><div>${escapeHtml(task.goal || "Unknown")}</div></div>
    <div><strong>Target URL</strong><div>${escapeHtml(targetUrl)}</div></div>
    <div><strong>Parser</strong><div>${escapeHtml(payload.parser_explanation || "")}</div></div>
    <div><strong>Input hints</strong><div class="task-pills">${pills}</div></div>
  `;
  elements.taskSummary.innerHTML = "";
  elements.taskSummary.appendChild(wrapper);
}

function renderBrowser(report, browser) {
  const steps = report.steps || [];
  const finalObservation = report.final_observation || null;
  const selectedStep = steps[state.selectedStepIndex] || null;
  const displayShot = selectedStep?.screenshot_url || finalObservation?.screenshot_url || "";
  const displayTitle = selectedStep?.observation_label || finalObservation?.screen_label || "No browser run yet";
  const displayUrl = selectedStep?.current_url || browser.final_url || finalObservation?.url || "Waiting for a run";
  const displaySummary = selectedStep?.observation_summary || finalObservation?.text_summary || "The browser summary will appear here.";

  elements.browserTitle.textContent = displayTitle;
  elements.browserUrl.textContent = displayUrl;
  elements.browserSummary.textContent = displaySummary;

  if (displayShot) {
    elements.browserImage.src = displayShot;
    elements.browserImage.style.display = "block";
    elements.browserPlaceholder.style.display = "none";
  } else {
    elements.browserImage.removeAttribute("src");
    elements.browserImage.style.display = "none";
    elements.browserPlaceholder.style.display = "grid";
  }
}

function renderStepGallery(steps) {
  elements.stepGallery.innerHTML = "";
  const finalObservation = state.currentPayload?.report?.final_observation || state.currentPayload?.last_run?.report?.final_observation || null;
  if (!steps.length && !finalObservation) {
    return;
  }

  steps.forEach((step, index) => {
    const card = document.createElement("button");
    card.className = `thumb-card${index === state.selectedStepIndex ? " active" : ""}`;
    card.innerHTML = `
      ${step.screenshot_url ? `<img src="${escapeAttribute(step.screenshot_url)}" alt="Step ${step.step_number} screenshot">` : ""}
      <div class="thumb-copy">
        <strong>Step ${step.step_number}</strong>
        <div>${escapeHtml(step.observation_label || step.screen_id || "Page")}</div>
      </div>
    `;
    card.addEventListener("click", () => {
      state.selectedStepIndex = index;
      render(state.currentPayload);
    });
    elements.stepGallery.appendChild(card);
  });

  if (finalObservation) {
    const finalIndex = steps.length;
    const card = document.createElement("button");
    card.className = `thumb-card${finalIndex === state.selectedStepIndex ? " active" : ""}`;
    card.innerHTML = `
      ${finalObservation.screenshot_url ? `<img src="${escapeAttribute(finalObservation.screenshot_url)}" alt="Final page screenshot">` : ""}
      <div class="thumb-copy">
        <strong>Final</strong>
        <div>${escapeHtml(finalObservation.screen_label || finalObservation.screen_id || "Final page")}</div>
      </div>
    `;
    card.addEventListener("click", () => {
      state.selectedStepIndex = finalIndex;
      render(state.currentPayload);
    });
    elements.stepGallery.appendChild(card);
  }
}

function renderSteps(steps) {
  elements.stepList.innerHTML = "";
  elements.stepCountBadge.textContent = `${steps.length} step${steps.length === 1 ? "" : "s"}`;
  if (!steps.length) {
    elements.stepList.textContent = "No run yet. Once the agent starts, every browser action will show up here.";
    return;
  }

  steps.forEach((step, index) => {
    const card = document.createElement("article");
    card.className = `step-card${index === state.selectedStepIndex ? " active" : ""}`;
    const visible = (step.visible_elements || []).slice(0, 6).map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("");
    const retrieval = (step.retrieval_lines || []).slice(0, 3).map((line) => `<span class="pill">${escapeHtml(line)}</span>`).join("");
    card.innerHTML = `
      <div class="step-head">
        <div>
          <div class="mini-label">Step ${step.step_number}</div>
          <h3>${escapeHtml(step.observation_label || step.screen_id || "Page")}</h3>
        </div>
        <span class="badge muted-badge">${escapeHtml(step.action?.kind || "stop")}${step.action?.target_id ? ` -> ${escapeHtml(step.action.target_id)}` : ""}</span>
      </div>
      <div>${escapeHtml(step.observation_summary || "")}</div>
      <div class="pill-row">
        <span class="pill"><strong>Why</strong>&nbsp;${escapeHtml(step.action_reason || step.action?.reason || "")}</span>
        <span class="pill"><strong>Result</strong>&nbsp;${escapeHtml(step.result_message || "")}</span>
      </div>
      <div class="pill-row">${visible}</div>
      <div class="pill-row">${retrieval}</div>
    `;
    card.addEventListener("click", () => {
      state.selectedStepIndex = index;
      render(state.currentPayload);
    });
    elements.stepList.appendChild(card);
  });
}

function renderGraph(graph, highlightedEdgeIds, highlightedNodeIds) {
  const svg = elements.graphCanvas;
  svg.innerHTML = `
    <defs>
      <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5" result="blur"></feGaussianBlur>
        <feMerge>
          <feMergeNode in="blur"></feMergeNode>
          <feMergeNode in="SourceGraphic"></feMergeNode>
        </feMerge>
      </filter>
    </defs>
  `;

  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  if (!nodes.length) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "50%");
    text.setAttribute("y", "50%");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "graph-empty");
    text.textContent = "Run the browser agent to build the graph.";
    svg.appendChild(text);
    elements.graphMeta.textContent = "Select a node to inspect its details.";
    return;
  }

  const layout = computeForceLayout(nodes, edges, 860, 620);
  const positions = new Map(layout.map((node) => [node.id, node]));
  const selectedNode = nodes.find((node) => node.id === state.selectedNodeId) || null;
  renderGraphMeta(selectedNode);

  edges.forEach((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) {
      return;
    }
    const highlighted = highlightedEdgeIds.includes(edge.id);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const midX = (source.x + target.x) / 2 + (-dy * 0.08);
    const midY = (source.y + target.y) / 2 + (dx * 0.08);
    path.setAttribute("d", `M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", highlighted ? "rgba(240, 154, 90, 0.96)" : edgeColor(edge.relation));
    path.setAttribute("stroke-width", highlighted ? "3.2" : `${Math.min(3, Math.max(1.2, Number(edge.weight || 1) * 0.6))}`);
    path.setAttribute("stroke-opacity", highlighted ? "0.96" : "0.42");
    if (highlighted) {
      path.setAttribute("filter", "url(#nodeGlow)");
    }
    svg.appendChild(path);
  });

  layout.forEach((node) => {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const highlighted = highlightedNodeIds.includes(node.id);
    const selected = node.id === state.selectedNodeId;
    const radius = node.radius;

    const outer = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    outer.setAttribute("cx", node.x);
    outer.setAttribute("cy", node.y);
    outer.setAttribute("r", String(radius));
    outer.setAttribute("fill", node.type === "screen" ? "rgba(104, 215, 255, 0.16)" : "rgba(255, 203, 125, 0.14)");
    outer.setAttribute("stroke", selected ? "rgba(255,255,255,0.96)" : highlighted ? "rgba(240, 154, 90, 0.9)" : node.type === "screen" ? "rgba(104, 215, 255, 0.58)" : "rgba(255, 203, 125, 0.5)");
    outer.setAttribute("stroke-width", selected ? "2.8" : highlighted ? "2.4" : "1.4");
    if (highlighted || selected) {
      outer.setAttribute("filter", "url(#nodeGlow)");
    }

    const inner = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    inner.setAttribute("cx", node.x);
    inner.setAttribute("cy", node.y);
    inner.setAttribute("r", String(Math.max(6, radius * 0.42)));
    inner.setAttribute("fill", node.type === "screen" ? "rgba(104, 215, 255, 0.95)" : "rgba(255, 203, 125, 0.92)");

    group.appendChild(outer);
    group.appendChild(inner);

    const shouldLabel = node.type === "screen" || highlighted || selected || Number(node.degree || 0) >= 4;
    if (shouldLabel) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", node.x);
      label.setAttribute("y", node.y + radius + 16);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", "#edf7ff");
      label.setAttribute("font-size", selected ? "12.5" : "11");
      label.textContent = shorten(node.label, 22);
      group.appendChild(label);
    }

    group.addEventListener("click", () => {
      state.selectedNodeId = node.id;
      render(state.currentPayload);
    });

    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${node.label} (${node.type})`;
    group.appendChild(title);
    svg.appendChild(group);
  });
}

function computeForceLayout(nodes, edges, width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  const positioned = nodes.map((node, index) => {
    const seed = hashText(node.id || `${index}`);
    const isScreen = node.type === "screen";
    const angle = ((seed % 360) * Math.PI) / 180;
    const ring = isScreen ? 140 : 250;
    return {
      ...node,
      x: centerX + Math.cos(angle) * ring,
      y: centerY + Math.sin(angle) * ring,
      vx: 0,
      vy: 0,
      radius: isScreen ? 22 + Math.min(10, Number(node.degree || 0)) : 14 + Math.min(8, Number(node.degree || 0) * 0.6),
    };
  });

  const byId = new Map(positioned.map((node) => [node.id, node]));

  for (let iteration = 0; iteration < 260; iteration += 1) {
    for (let i = 0; i < positioned.length; i += 1) {
      const left = positioned[i];
      for (let j = i + 1; j < positioned.length; j += 1) {
        const right = positioned[j];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy) || 0.001;
        const minGap = left.radius + right.radius + 26;
        const repulsion = 1700 / (distance * distance);
        const forceX = (dx / distance) * repulsion;
        const forceY = (dy / distance) * repulsion;
        left.vx -= forceX;
        left.vy -= forceY;
        right.vx += forceX;
        right.vy += forceY;

        if (distance < minGap) {
          const push = (minGap - distance) * 0.08;
          dx /= distance;
          dy /= distance;
          left.vx -= dx * push;
          left.vy -= dy * push;
          right.vx += dx * push;
          right.vy += dy * push;
        }
      }
    }

    edges.forEach((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) {
        return;
      }
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy) || 0.001;
      const desired = edge.relation === "contains" ? 130 : edge.relation === "leads_to" ? 180 : 160;
      const spring = (distance - desired) * 0.0018;
      const fx = (dx / distance) * spring * 100;
      const fy = (dy / distance) * spring * 100;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    });

    positioned.forEach((node) => {
      const seed = hashText(node.id);
      const anchorAngle = ((seed % 360) * Math.PI) / 180;
      const anchorRadius = node.type === "screen" ? 140 : 250;
      const anchorX = centerX + Math.cos(anchorAngle) * anchorRadius;
      const anchorY = centerY + Math.sin(anchorAngle) * anchorRadius;
      node.vx += (anchorX - node.x) * 0.0009;
      node.vy += (anchorY - node.y) * 0.0009;
      node.vx += (centerX - node.x) * 0.00018;
      node.vy += (centerY - node.y) * 0.00018;
      node.vx *= 0.86;
      node.vy *= 0.86;
      node.x = clamp(node.x + node.vx, node.radius + 28, width - node.radius - 28);
      node.y = clamp(node.y + node.vy, node.radius + 28, height - node.radius - 28);
    });
  }

  return positioned;
}

function renderGraphMeta(node) {
  if (!node) {
    elements.graphMeta.textContent = "Select a node to inspect its details.";
    return;
  }

  const attributes = Object.entries(node.attributes || {})
    .slice(0, 8)
    .map(([key, value]) => `<span class="pill">${escapeHtml(key)}: ${escapeHtml(String(value))}</span>`)
    .join("");
  elements.graphMeta.innerHTML = `
    <div><strong>${escapeHtml(node.label)}</strong></div>
    <div>Type: ${escapeHtml(node.type)}</div>
    <div>Degree: ${escapeHtml(String(node.degree || 0))}</div>
    <div class="pill-row">${attributes || '<span class="pill">No extra attributes</span>'}</div>
  `;
}

function edgeColor(relation) {
  if (relation === "leads_to") {
    return "rgba(240, 154, 90, 0.54)";
  }
  if (relation === "clicked") {
    return "rgba(73, 192, 182, 0.5)";
  }
  if (relation === "filled") {
    return "rgba(104, 215, 255, 0.46)";
  }
  return "rgba(255, 255, 255, 0.18)";
}

function formatIntent(intent) {
  return String(intent || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hashText(value) {
  let hash = 7;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shorten(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
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
