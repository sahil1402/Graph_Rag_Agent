const fs = require("fs");
const path = require("path");
const playwrightCorePath = process.env.PLAYWRIGHT_CORE_PATH;
if (!playwrightCorePath) {
  throw new Error("PLAYWRIGHT_CORE_PATH was not provided to the browser runner.");
}
const { chromium } = require(playwrightCorePath);

const requestPath = process.argv[2];
const responsePath = process.argv[3];

const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));

function tokenize(text) {
  return new Set(String(text || "").toLowerCase().match(/[a-z0-9]+/g) || []);
}

function overlapScore(left, right) {
  const a = tokenize(left);
  const b = tokenize(right);
  let score = 0;
  for (const token of a) {
    if (b.has(token)) {
      score += 1;
    }
  }
  return score;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function graphFromPayload(payload) {
  const graph = {
    nodes: new Map(),
    edges: [],
    adjacency: new Map(),
  };

  for (const node of payload.nodes || []) {
    graph.nodes.set(node.id, node);
  }

  for (const edge of payload.edges || []) {
    graph.edges.push(edge);
    if (!graph.adjacency.has(edge.source)) {
      graph.adjacency.set(edge.source, []);
    }
    graph.adjacency.get(edge.source).push(edge);
  }

  return graph;
}

function outgoing(graph, sourceId, relation) {
  const edges = graph.adjacency.get(sourceId) || [];
  if (!relation) {
    return edges.slice();
  }
  return edges.filter((edge) => edge.relation === relation);
}

function edgeMetric(graph, sourceId, relation, targetId, key) {
  const match = outgoing(graph, sourceId, relation).find((edge) => edge.target === targetId);
  if (!match) {
    return 0;
  }
  const value = match.attributes ? match.attributes[key] : 0;
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function shortestPathLength(graph, startId, goalId, relations = null, maxDepth = 6) {
  if (!goalId) {
    return null;
  }
  if (startId === goalId) {
    return 0;
  }
  const queue = [[startId, 0]];
  const visited = new Set([startId]);

  while (queue.length > 0) {
    const [nodeId, depth] = queue.shift();
    if (depth >= maxDepth) {
      continue;
    }

    for (const edge of outgoing(graph, nodeId)) {
      if (relations && !relations.has(edge.relation)) {
        continue;
      }
      if (edge.target === goalId) {
        return depth + 1;
      }
      if (!visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push([edge.target, depth + 1]);
      }
    }
  }

  return null;
}

function extractInputValue(element, taskInputs, command) {
  const text = `${element.label} ${element.description || ""} ${element.input_key || ""}`.toLowerCase();
  const genericSearch = taskInputs.search || "";

  if (text.includes("date") && !taskInputs.depart_date) {
    return null;
  }

  const candidates = [
    [["from city", "origin", "from"], taskInputs.from_city],
    [["to city", "destination", "to"], taskInputs.to_city],
    [["date", "depart date", "departure"], taskInputs.depart_date],
    [["email", "mail"], taskInputs.email],
    [["password", "passcode"], taskInputs.password],
    [["name", "full name"], taskInputs.name],
    [["phone", "mobile", "contact"], taskInputs.phone],
    [["search", "query", "keyword"], genericSearch],
  ];

  for (const [keywords, value] of candidates) {
    if (!value) {
      continue;
    }
    if (keywords.some((keyword) => text.includes(keyword))) {
      return value;
    }
  }

  if (genericSearch && (text.includes("input") || text.includes("search"))) {
    return genericSearch;
  }

  return null;
}

function detectSuccess(observation, task, command) {
  const haystack = `${observation.screen_id} ${observation.screen_label} ${observation.text_summary} ${observation.url}`.toLowerCase();
  if (task.success_screen_id && observation.screen_id === task.success_screen_id) {
    return true;
  }
  if (!task.success_screen_id) {
    if (haystack.includes("success") || haystack.includes("complete") || haystack.includes("confirmation")) {
      return true;
    }
    if (command.toLowerCase().includes("deal") && haystack.includes("deal")) {
      return true;
    }
  }
  return false;
}

async function annotatePage(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        style.opacity !== "0";
    };

    const labelFor = (element) => {
      const direct = [
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder"),
        element.getAttribute("name"),
        element.innerText,
        element.textContent,
        element.value,
      ]
        .map((value) => String(value || "").replace(/\s+/g, " ").trim())
        .find((value) => value.length > 0);
      return direct || element.tagName.toLowerCase();
    };

    const describe = (element) => {
      return [
        element.getAttribute("title"),
        element.getAttribute("aria-description"),
        element.getAttribute("placeholder"),
      ]
        .map((value) => String(value || "").replace(/\s+/g, " ").trim())
        .find((value) => value.length > 0) || "";
    };

    const roleFor = (element) => {
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role");
      if (tag === "input" || tag === "textarea" || tag === "select") {
        return "input";
      }
      if (role === "button" || tag === "button") {
        return "button";
      }
      if (role === "link" || tag === "a") {
        return "link";
      }
      return "button";
    };

    const body = document.body;
    const pageTitle = document.querySelector("h1")?.innerText?.trim() || document.title || location.pathname;
    const screenId = body?.dataset?.screenId || location.pathname || "page";
    const candidates = Array.from(
      document.querySelectorAll("a, button, input, textarea, select, [role=button], [role=link]")
    );

    const elements = [];
    let index = 0;
    for (const element of candidates) {
      if (!visible(element)) {
        continue;
      }

      const label = labelFor(element);
      const role = roleFor(element);
      const description = describe(element);
      const inputKey = element.getAttribute("name") || element.getAttribute("data-field-key") || "";
      const value = role === "input" ? String(element.value || "") : "";
      const source = [
        screenId,
        role,
        label,
        element.getAttribute("name") || "",
        element.getAttribute("placeholder") || "",
        element.getAttribute("href") || "",
        String(index),
      ].join("|");
      const elementId = `el_${source.split("").reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 7).toString(16)}`;
      element.setAttribute("data-graphrag-id", elementId);
      elements.push({
        element_id: elementId,
        label,
        role,
        description,
        input_key: inputKey,
        value,
        selector: `[data-graphrag-id="${elementId}"]`,
      });
      index += 1;
    }

    const previewText = body?.innerText?.replace(/\s+/g, " ").trim() || "";
    return {
      screen_id: screenId,
      screen_label: pageTitle,
      text_summary: `${pageTitle}. URL: ${location.href}. ${previewText.slice(0, 280)}`.trim(),
      visual_summary: `Visible actions: ${elements.map((element) => element.label).slice(0, 8).join(", ")}`,
      url: location.href,
      title: document.title || pageTitle,
      elements,
    };
  });
}

async function captureObservation(page, stepNumber, screensDir, artifactsBaseUrl) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(240);
  const observation = await annotatePage(page);
  const fileName = `step-${String(stepNumber).padStart(2, "0")}.png`;
  const screenshotPath = path.join(screensDir, fileName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  observation.screenshot_url = `${artifactsBaseUrl}/screens/${fileName}`;
  return observation;
}

async function peekPage(page) {
  return page.evaluate(() => ({
    screen_id: document.body?.dataset?.screenId || location.pathname || "page",
    url: location.href,
    title: document.title || location.pathname,
  }));
}

function buildRetrievalLines(graph, observation) {
  const lines = [];
  for (const edge of outgoing(graph, observation.screen_id).slice(0, 5)) {
    const source = graph.nodes.get(edge.source);
    const target = graph.nodes.get(edge.target);
    if (source && target) {
      lines.push(`${source.label} --${edge.relation}--> ${target.label}`);
    }
  }
  return lines;
}

function chooseAction({ observation, command, task, graph, visitedActions }) {
  const taskInputs = task.required_inputs || {};
  for (const element of observation.elements) {
    if (element.role !== "input") {
      continue;
    }
    const intendedValue = extractInputValue(element, taskInputs, command);
    if (intendedValue && String(element.value || "") !== intendedValue) {
      return {
        kind: "type",
        target_id: element.element_id,
        selector: element.selector,
        value: intendedValue,
        reason: `Filled ${element.label} from parsed command hints.`,
      };
    }
  }

  const clickables = observation.elements.filter((element) => element.role === "button" || element.role === "link");
  if (clickables.length === 0) {
    return { kind: "stop", reason: "No visible clickable elements remain." };
  }

  const scored = clickables.map((element) => {
    let score = overlapScore(command, `${element.label} ${element.description || ""}`);
    score += 0.4 * overlapScore(task.goal || command, `${element.label} ${element.description || ""}`);

    for (const edge of outgoing(graph, element.element_id, "leads_to")) {
      const destination = graph.nodes.get(edge.target);
      if (!destination) {
        continue;
      }
      score += 2.8 * overlapScore(task.goal || command, `${destination.label} ${JSON.stringify(destination.attributes || {})}`);
      score += 1.8 * edgeMetric(graph, element.element_id, "leads_to", edge.target, "success_count");
      const distance = shortestPathLength(graph, edge.target, task.success_screen_id, new Set(["contains", "leads_to"]));
      if (distance !== null) {
        score += Math.max(0, 4.5 - distance);
      }
    }

    score += 1.2 * edgeMetric(graph, observation.screen_id, "clicked", element.element_id, "success_count");
    const visitKey = `${observation.screen_id}::${element.element_id}`;
    if (visitedActions.has(visitKey)) {
      score -= 1.75;
    }

    return { element, score };
  });

  scored.sort((left, right) => right.score - left.score || left.element.label.localeCompare(right.element.label));
  const winner = scored[0];
  return {
    kind: "click",
    target_id: winner.element.element_id,
    selector: winner.element.selector,
    reason: "Selected using browser-side graph-aware action ranking.",
  };
}

async function executeAction(page, action) {
  if (action.kind === "type") {
    const locator = page.locator(action.selector).first();
    await locator.fill(String(action.value || ""));
    return {
      message: `Filled ${action.target_id} with ${JSON.stringify(action.value || "")}.`,
    };
  }

  if (action.kind === "click") {
    const locator = page.locator(action.selector).first();
    await Promise.allSettled([
      page.waitForLoadState("domcontentloaded", { timeout: 2200 }),
      locator.click({ timeout: 2200 }),
    ]);
    await page.waitForTimeout(280);
    return {
      message: `Clicked ${action.target_id}.`,
    };
  }

  return { message: "Stopped without an action." };
}

async function main() {
  const graph = graphFromPayload(request.graph || { nodes: [], edges: [] });
  const browser = await chromium.launch({
    headless: true,
    channel: "msedge",
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const steps = [];
  const visitedActions = new Set();

  try {
    await page.goto(request.targetUrl, { waitUntil: "domcontentloaded" });
    const maxSteps = Number(request.maxSteps || 8);

    for (let stepNumber = 1; stepNumber <= maxSteps; stepNumber += 1) {
      const observation = await captureObservation(
        page,
        stepNumber,
        request.screensDir,
        request.artifactsBaseUrl,
      );

      if (detectSuccess(observation, request.task || {}, request.command)) {
        break;
      }

      const retrievalLines = buildRetrievalLines(graph, observation);
      const action = chooseAction({
        observation,
        command: request.command,
        task: request.task || {},
        graph,
        visitedActions,
      });

      if (action.kind === "stop") {
        steps.push({
          step_number: stepNumber,
          screen_id: observation.screen_id,
          observation_label: observation.screen_label,
          observation_summary: observation.text_summary,
          elements: observation.elements,
          visible_elements: observation.elements.map((element) => element.label),
          context_summary: retrievalLines.slice(0, 3).join("; ") || "No graph context yet.",
          retrieval_lines: retrievalLines,
          action,
          action_reason: action.reason,
          result_message: action.reason,
          next_screen_id: observation.screen_id,
          screenshot_url: observation.screenshot_url,
          current_url: observation.url,
        });
        break;
      }

      const visitKey = `${observation.screen_id}::${action.target_id}`;
      visitedActions.add(visitKey);
      const result = await executeAction(page, action);
      const nextPage = await peekPage(page);

      steps.push({
        step_number: stepNumber,
        screen_id: observation.screen_id,
        observation_label: observation.screen_label,
        observation_summary: observation.text_summary,
        elements: observation.elements,
        visible_elements: observation.elements.map((element) => element.label),
        context_summary: retrievalLines.slice(0, 3).join("; ") || "No graph context yet.",
        retrieval_lines: retrievalLines,
        action: {
          kind: action.kind,
          target_id: action.target_id,
          value: action.value || null,
          reason: action.reason,
        },
        action_reason: action.reason,
        result_message: result.message,
        next_screen_id: nextPage.screen_id,
        screenshot_url: observation.screenshot_url,
        current_url: observation.url,
      });

      if (nextPage.screen_id === request.task.success_screen_id) {
        break;
      }
    }

    const finalObservation = await captureObservation(
      page,
      steps.length + 1,
      request.screensDir,
      request.artifactsBaseUrl,
    );
    const success = detectSuccess(finalObservation, request.task || {}, request.command);
    const payload = {
      report: {
        goal: request.task.goal || request.command,
        success,
        steps,
        final_screen_id: finalObservation.screen_id,
        final_observation: finalObservation,
      },
      browser: {
        final_url: finalObservation.url,
        final_title: finalObservation.title,
        screenshot_url: finalObservation.screenshot_url,
      },
    };
    fs.writeFileSync(responsePath, JSON.stringify(payload, null, 2), "utf8");
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  fs.writeFileSync(
    responsePath,
    JSON.stringify({ error: String(error && error.stack ? error.stack : error) }, null, 2),
    "utf8",
  );
  console.error(error);
  process.exit(1);
});
