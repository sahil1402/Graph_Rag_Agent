const state = {
  currentPayload: null,
  selectedStepIndex: 0,
  selectedNodeId: null,
};

let graphResizeTimer = 0;

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
  const { width, height } = measureGraphViewport(svg);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
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

  const labeledNodeIds = pickLabeledNodeIds(nodes, highlightedNodeIds);
  const layout = computeForceLayout(nodes, edges, width, height, labeledNodeIds, highlightedNodeIds);
  const positions = new Map(layout.map((node) => [node.id, node]));
  const selectedNode = layout.find((node) => node.id === state.selectedNodeId) || null;
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

    if (labeledNodeIds.has(node.id) && node.labelPlacement) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", node.labelPlacement.x);
      label.setAttribute("y", node.labelPlacement.y);
      label.setAttribute("text-anchor", node.labelPlacement.anchor);
      label.setAttribute("dominant-baseline", "middle");
      label.setAttribute("class", `graph-node-label${selected ? " selected" : ""}`);
      label.setAttribute("font-size", selected ? "12.6" : node.type === "screen" ? "11.8" : "10.6");
      label.textContent = node.labelText || shorten(node.label, 22);
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

function measureGraphViewport(svg) {
  const bounds = svg.getBoundingClientRect();
  return {
    width: Math.max(360, Math.round(bounds.width || svg.clientWidth || 860)),
    height: Math.max(560, Math.round(bounds.height || svg.clientHeight || 620)),
  };
}

function pickLabeledNodeIds(nodes, highlightedNodeIds) {
  const labeled = new Set(highlightedNodeIds || []);
  if (state.selectedNodeId) {
    labeled.add(state.selectedNodeId);
  }

  nodes
    .filter((node) => node.type === "screen")
    .sort((left, right) => Number(right.degree || 0) - Number(left.degree || 0) || sortBySeed(left, right))
    .forEach((node) => labeled.add(node.id));

  nodes
    .filter((node) => node.type !== "screen")
    .sort((left, right) => {
      const degreeDiff = Number(right.degree || 0) - Number(left.degree || 0);
      if (degreeDiff) {
        return degreeDiff;
      }
      const attributeDiff = Object.keys(right.attributes || {}).length - Object.keys(left.attributes || {}).length;
      if (attributeDiff) {
        return attributeDiff;
      }
      return sortBySeed(left, right);
    })
    .slice(0, Math.min(5, Math.max(2, Math.floor(nodes.length / 6))))
    .forEach((node) => labeled.add(node.id));

  return labeled;
}

function computeForceLayout(nodes, edges, width, height, labeledNodeIds, highlightedNodeIds) {
  const centerX = width / 2;
  const centerY = height / 2;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const orderedNodes = nodes.slice().sort(sortBySeed);
  const screenNodes = orderedNodes.filter((node) => node.type === "screen");
  const containsByScreen = new Map(screenNodes.map((node) => [node.id, []]));
  const ownerByNode = new Map();

  edges.forEach((edge) => {
    if (edge.relation !== "contains") {
      return;
    }

    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      return;
    }

    if (source.type === "screen" && target.type !== "screen") {
      containsByScreen.get(source.id)?.push(target);
      ownerByNode.set(target.id, source.id);
      return;
    }

    if (target.type === "screen" && source.type !== "screen") {
      containsByScreen.get(target.id)?.push(source);
      ownerByNode.set(source.id, target.id);
    }
  });

  containsByScreen.forEach((members, screenId) => {
    containsByScreen.set(
      screenId,
      members.slice().sort((left, right) => sortBySeed(left, right)),
    );
  });

  const screenAnchors = buildScreenAnchors(screenNodes, width, height);
  const orphanNodes = orderedNodes.filter((node) => node.type !== "screen" && !ownerByNode.has(node.id));
  const orphanIndexById = new Map(orphanNodes.map((node, index) => [node.id, index]));

  const positioned = orderedNodes.map((node, index) => {
    const radius = node.type === "screen"
      ? 22 + Math.min(10, Number(node.degree || 0) * 0.8)
      : 12 + Math.min(7, Number(node.degree || 0) * 0.55);
    const labelSpace = labeledNodeIds.has(node.id)
      ? node.type === "screen" ? 30 : 22
      : 10;
    const anchor = initialNodeAnchor(
      node,
      index,
      screenAnchors,
      containsByScreen,
      ownerByNode,
      orphanIndexById,
      orphanNodes.length,
      width,
      height,
      centerX,
      centerY,
    );
    return {
      ...node,
      x: anchor.x,
      y: anchor.y,
      anchorX: anchor.x,
      anchorY: anchor.y,
      vx: 0,
      vy: 0,
      radius,
      collisionRadius: radius + labelSpace,
      ownerId: ownerByNode.get(node.id) || null,
    };
  });

  const byId = new Map(positioned.map((node) => [node.id, node]));

  for (let iteration = 0; iteration < 220; iteration += 1) {
    for (let i = 0; i < positioned.length; i += 1) {
      const left = positioned[i];
      for (let j = i + 1; j < positioned.length; j += 1) {
        const right = positioned[j];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy) || 0.001;
        const sameCluster = left.ownerId && left.ownerId === right.ownerId;
        const minGap = left.collisionRadius + right.collisionRadius + (sameCluster ? 12 : 18);
        const repulsion = (sameCluster ? 2600 : 3800) / (distance * distance);
        const forceX = (dx / distance) * repulsion;
        const forceY = (dy / distance) * repulsion;
        left.vx -= forceX;
        left.vy -= forceY;
        right.vx += forceX;
        right.vy += forceY;

        if (distance < minGap) {
          const push = (minGap - distance) * 0.11;
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
      const desired = edge.relation === "contains"
        ? 118
        : edge.relation === "leads_to"
          ? 178
          : edge.relation === "clicked"
            ? 142
            : edge.relation === "filled"
              ? 150
              : 160;
      const spring = (distance - desired) * 0.013;
      const fx = (dx / distance) * spring;
      const fy = (dy / distance) * spring;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    });

    positioned.forEach((node) => {
      const anchorPull = node.type === "screen" ? 0.075 : 0.055;
      node.vx += (node.anchorX - node.x) * anchorPull;
      node.vy += (node.anchorY - node.y) * anchorPull;
      node.vx *= node.type === "screen" ? 0.78 : 0.82;
      node.vy *= node.type === "screen" ? 0.78 : 0.82;
      const limitX = node.collisionRadius + 22;
      const limitY = node.collisionRadius + 22;
      node.x = clamp(node.x + node.vx, limitX, width - limitX);
      node.y = clamp(node.y + node.vy, limitY, height - limitY);
    });
  }

  resolveLabelPlacements(positioned, labeledNodeIds, highlightedNodeIds, width, height, centerX, centerY);
  return positioned;
}

function buildScreenAnchors(screenNodes, width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  const total = Math.max(1, screenNodes.length);
  const radiusX = clamp(width * 0.29, 102, width / 2 - 78);
  const radiusY = clamp(height * 0.31, 120, height / 2 - 92);
  const anchors = new Map();

  screenNodes.forEach((node, index) => {
    const jitter = ((hashText(node.id) % 9) - 4) * 0.05;
    const angle = -Math.PI / 2 + (index / total) * Math.PI * 2 + jitter;
    anchors.set(node.id, {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
      angle,
    });
  });

  return anchors;
}

function initialNodeAnchor(
  node,
  index,
  screenAnchors,
  containsByScreen,
  ownerByNode,
  orphanIndexById,
  orphanCount,
  width,
  height,
  centerX,
  centerY,
) {
  if (node.type === "screen") {
    return screenAnchors.get(node.id) || { x: centerX, y: centerY };
  }

  const ownerId = ownerByNode.get(node.id);
  const ownerAnchor = ownerId ? screenAnchors.get(ownerId) : null;
  if (ownerId && ownerAnchor) {
    const members = containsByScreen.get(ownerId) || [];
    const localIndex = Math.max(0, members.findIndex((member) => member.id === node.id));
    const localCount = Math.max(1, members.length);
    const ringSize = localCount > 8 ? 5 : 4;
    const ringIndex = Math.floor(localIndex / ringSize);
    const slotCount = Math.max(1, Math.min(ringSize, localCount - ringIndex * ringSize));
    const slotIndex = localIndex % ringSize;
    const arc = Math.min(Math.PI * 1.35, 0.95 + slotCount * 0.36);
    const angle = slotCount === 1
      ? ownerAnchor.angle
      : ownerAnchor.angle - arc / 2 + (slotIndex / Math.max(1, slotCount - 1)) * arc;
    const radiusX = 84 + ringIndex * 52 + Math.min(18, localCount * 1.6);
    const radiusY = 68 + ringIndex * 44 + Math.min(14, localCount * 1.4);
    return {
      x: ownerAnchor.x + Math.cos(angle) * radiusX,
      y: ownerAnchor.y + Math.sin(angle) * radiusY,
    };
  }

  const fallbackCount = Math.max(1, orphanCount);
  const orphanIndex = orphanIndexById.get(node.id) ?? index;
  const angle = -Math.PI / 2
    + (orphanIndex / fallbackCount) * Math.PI * 2
    + (((hashText(node.id) % 11) - 5) * 0.12);
  const radiusX = clamp(width * 0.16, 56, width / 2 - 92);
  const radiusY = clamp(height * 0.14, 64, height / 2 - 120);
  return {
    x: centerX + Math.cos(angle) * radiusX,
    y: centerY + Math.sin(angle) * radiusY,
  };
}

function resolveLabelPlacements(nodes, labeledNodeIds, highlightedNodeIds, width, height, centerX, centerY) {
  const highlightedSet = new Set(highlightedNodeIds || []);
  const placedBoxes = [];

  nodes
    .filter((node) => labeledNodeIds.has(node.id))
    .sort((left, right) => labelPriority(right, highlightedSet) - labelPriority(left, highlightedSet))
    .forEach((node) => {
      const fontSize = node.id === state.selectedNodeId ? 12.6 : node.type === "screen" ? 11.8 : 10.6;
      const labelText = shorten(node.label, node.type === "screen" ? 24 : 18);
      const candidates = buildLabelCandidates(node, labelText, fontSize, width, height, centerX, centerY);
      let bestCandidate = candidates[0];
      let bestScore = Number.POSITIVE_INFINITY;

      candidates.forEach((candidate) => {
        let score = candidate.primary ? -55 : 0;
        score += Math.hypot(candidate.x - node.x, candidate.y - node.y) * 0.08;

        placedBoxes.forEach((box) => {
          if (boxesOverlap(candidate.box, box)) {
            score += 1600 + overlapArea(candidate.box, box);
          }
        });

        nodes.forEach((other) => {
          if (other.id !== node.id && circleIntersectsBox(other.x, other.y, other.radius + 4, candidate.box)) {
            score += 220;
          }
        });

        if (score < bestScore) {
          bestCandidate = candidate;
          bestScore = score;
        }
      });

      node.labelText = labelText;
      node.labelPlacement = bestCandidate;
      placedBoxes.push(bestCandidate.box);
    });
}

function labelPriority(node, highlightedSet) {
  let priority = node.type === "screen" ? 300 : 120;
  if (node.id === state.selectedNodeId) {
    priority += 500;
  }
  if (highlightedSet.has(node.id)) {
    priority += 250;
  }
  return priority + Number(node.degree || 0) * 10;
}

function buildLabelCandidates(node, text, fontSize, width, height, centerX, centerY) {
  const baseDistance = node.radius + (node.type === "screen" ? 24 : 18);
  const outwardAngle = Math.atan2(node.y - centerY, node.x - centerX) || (-Math.PI / 2);
  const angleChoices = [
    { angle: outwardAngle, primary: true },
    { angle: outwardAngle - 0.68, primary: false },
    { angle: outwardAngle + 0.68, primary: false },
    { angle: -Math.PI / 2, primary: false },
    { angle: Math.PI / 2, primary: false },
    { angle: Math.PI, primary: false },
    { angle: 0, primary: false },
  ];

  return angleChoices.map(({ angle, primary }) => {
    let x = node.x + Math.cos(angle) * baseDistance;
    let y = node.y + Math.sin(angle) * baseDistance;
    const horizontal = Math.cos(angle);
    const anchor = horizontal > 0.34 ? "start" : horizontal < -0.34 ? "end" : "middle";
    let box = estimateLabelBox(x, y, text, fontSize, anchor);

    const shiftX = box.left < 12 ? 12 - box.left : box.right > width - 12 ? (width - 12) - box.right : 0;
    const shiftY = box.top < 12 ? 12 - box.top : box.bottom > height - 12 ? (height - 12) - box.bottom : 0;
    x += shiftX;
    y += shiftY;
    box = estimateLabelBox(x, y, text, fontSize, anchor);

    return { x, y, anchor, box, primary };
  });
}

function estimateLabelBox(x, y, text, fontSize, anchor) {
  const textWidth = Math.max(44, text.length * fontSize * 0.58);
  const textHeight = fontSize + 8;
  const startX = anchor === "start"
    ? x
    : anchor === "end"
      ? x - textWidth
      : x - textWidth / 2;
  return {
    left: startX - 4,
    right: startX + textWidth + 4,
    top: y - textHeight / 2 - 3,
    bottom: y + textHeight / 2 + 3,
  };
}

function boxesOverlap(left, right) {
  return !(left.right <= right.left || left.left >= right.right || left.bottom <= right.top || left.top >= right.bottom);
}

function overlapArea(left, right) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height;
}

function circleIntersectsBox(cx, cy, radius, box) {
  const nearestX = clamp(cx, box.left, box.right);
  const nearestY = clamp(cy, box.top, box.bottom);
  return Math.hypot(cx - nearestX, cy - nearestY) < radius;
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

function sortBySeed(left, right) {
  return hashText(left.id || left.label || "") - hashText(right.id || right.label || "");
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
window.addEventListener("resize", () => {
  window.clearTimeout(graphResizeTimer);
  graphResizeTimer = window.setTimeout(() => {
    if (state.currentPayload) {
      render(state.currentPayload);
    }
  }, 120);
});

loadState().catch((error) => {
  elements.statusMessage.textContent = `Failed to load app state: ${error}`;
});
