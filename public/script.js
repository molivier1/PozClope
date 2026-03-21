const MAP_SIZE = 58;
const BASE_CELL_SIZE = 22;
const RICH_PLANET_THRESHOLD = 2000;

const state = {
  zoom: 1,
  ships: [],
  leaderboard: [],
  economyPlan: null,
  cells: new Map(),
  cellElements: new Map(),
  range: {
    x: [0, 57],
    y: [0, 57]
  },
  followShips: true,
  unauthorized: false,
  refreshTimer: null,
  firstRenderDone: false
};

const elements = {
  mapGrid: document.querySelector("#mapGrid"),
  mapViewport: document.querySelector("#mapViewport"),
  tooltip: document.querySelector("#tooltip"),
  refreshButton: document.querySelector("#refreshButton"),
  refreshSelect: document.querySelector("#refreshSelect"),
  followShipsToggle: document.querySelector("#followShipsToggle"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  fitButton: document.querySelector("#fitButton"),
  statusText: document.querySelector("#statusText"),
  knownCount: document.querySelector("#knownCount"),
  planetCount: document.querySelector("#planetCount"),
  richCount: document.querySelector("#richCount"),
  shipCount: document.querySelector("#shipCount"),
  economyStatus: document.querySelector("#economyStatus"),
  economySummary: document.querySelector("#economySummary"),
  economyList: document.querySelector("#economyList"),
  leaderboardStatus: document.querySelector("#leaderboardStatus"),
  leaderboardList: document.querySelector("#leaderboardList"),
  fleetList: document.querySelector("#fleetList"),
  targetsList: document.querySelector("#targetsList"),
  rangeLabel: document.querySelector("#rangeLabel"),
  lastUpdate: document.querySelector("#lastUpdate"),
  zoomLabel: document.querySelector("#zoomLabel")
};

function keyFor(x, y) {
  return `${x},${y}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatCoord(x, y) {
  return `(${x}, ${y})`;
}

function buildGrid() {
  const fragment = document.createDocumentFragment();

  for (let y = 0; y < MAP_SIZE; y += 1) {
    for (let x = 0; x < MAP_SIZE; x += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      cell.setAttribute("role", "gridcell");
      state.cellElements.set(keyFor(x, y), cell);
      fragment.appendChild(cell);
    }
  }

  elements.mapGrid.appendChild(fragment);
}

function setZoom(nextZoom) {
  state.zoom = clamp(nextZoom, 0.6, 2.6);
  const cellSize = Math.round(BASE_CELL_SIZE * state.zoom);
  document.documentElement.style.setProperty("--cell-size", `${cellSize}px`);
  elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function getPlanetMinerals(cell) {
  return Number(cell?.planete?.mineraiDisponible ?? 0);
}

function isEmptySector(cell) {
  return Boolean(cell?.planete?.estVide || cell?.planete?.typePlanete === "VIDE");
}

function isRichPlanet(cell) {
  return (
    Boolean(cell?.planete) &&
    !isEmptySector(cell) &&
    getPlanetMinerals(cell) >= RICH_PLANET_THRESHOLD
  );
}

function hasOwner(cell) {
  return Boolean(cell?.proprietaire?.identifiant || cell?.proprietaire?.nom);
}

function shipsByCell() {
  const index = new Map();

  for (const ship of state.ships) {
    const key = keyFor(ship.coord_x, ship.coord_y);
    const list = index.get(key) ?? [];
    list.push(ship);
    index.set(key, list);
  }

  return index;
}

function renderMap() {
  const shipIndex = shipsByCell();

  for (const [key, element] of state.cellElements.entries()) {
    const cell = state.cells.get(key);
    const ships = shipIndex.get(key) ?? [];

    element.className = "cell";
    element.dataset.shipCount = "";

    if (!cell) {
      continue;
    }

    element.classList.add("cell--known");

    if (isEmptySector(cell)) {
      element.classList.add("cell--sector-empty");
    } else if (cell.planete) {
      element.classList.add("cell--planet");

      if (!hasOwner(cell)) {
        element.classList.add("cell--planet-neutral");
      }

      if (isRichPlanet(cell)) {
        element.classList.add("cell--planet-rich");
      }
    }

    if (ships.length > 0) {
      element.classList.add("cell--ship");
      element.dataset.shipCount = String(ships.length);
    }
  }
}

function renderFleet() {
  elements.fleetList.classList.remove("empty-state");

  if (!state.ships.length) {
    elements.fleetList.classList.add("empty-state");
    elements.fleetList.innerHTML = "<li>Aucun vaisseau detecte.</li>";
    return;
  }

  elements.fleetList.innerHTML = state.ships
    .map((ship) => {
      const typeLabel = ship.type ? `${ship.type} | ` : "";
      return `
        <li>
          <strong>${ship.nom}</strong>
          <span>${typeLabel}${formatCoord(ship.coord_x, ship.coord_y)}</span>
        </li>
      `;
    })
    .join("");
}

function renderLeaderboard(entries, message) {
  elements.leaderboardList.classList.remove("empty-state");

  if (message) {
    elements.leaderboardStatus.textContent = "indispo";
    elements.leaderboardList.classList.add("empty-state");
    elements.leaderboardList.innerHTML = `<li>${message}</li>`;
    return;
  }

  if (!entries.length) {
    elements.leaderboardStatus.textContent = "0 eq";
    elements.leaderboardList.classList.add("empty-state");
    elements.leaderboardList.innerHTML = "<li>Aucune equipe remontee.</li>";
    return;
  }

  elements.leaderboardStatus.textContent = `${entries.length} eq`;
  elements.leaderboardList.innerHTML = entries
    .slice(0, 10)
    .map((entry) => {
      const itemClass = entry.isCurrentTeam ? "leaderboard-item--me" : "";

      return `
        <li class="${itemClass}">
          <span class="leaderboard-rank">${entry.rang}</span>
          <span class="leaderboard-name">${entry.nom}</span>
          <span class="leaderboard-score">${entry.score}</span>
        </li>
      `;
    })
    .join("");
}

function setUnauthorizedState(message) {
  state.unauthorized = true;
  elements.statusText.textContent = message;
  renderEconomyPlan(null, message);
  renderLeaderboard([], message);

  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function renderEconomyPlan(plan, message) {
  elements.economyList.classList.remove("empty-state");

  if (message) {
    elements.economyStatus.textContent = "indispo";
    elements.economySummary.innerHTML = `<span class="muted">${message}</span>`;
    elements.economyList.classList.add("empty-state");
    elements.economyList.innerHTML = `<li>${message}</li>`;
    return;
  }

  if (!plan) {
    elements.economyStatus.textContent = "-";
    elements.economySummary.innerHTML = `<span class="muted">Pas encore d'analyse.</span>`;
    elements.economyList.classList.add("empty-state");
    elements.economyList.innerHTML = "<li>Pas encore de recommandations.</li>";
    return;
  }

  elements.economyStatus.textContent = plan.summary.hasCargo ? "stable" : "setup";
  elements.economySummary.innerHTML = `
    <div class="economy-chip">
      <strong>Ressources</strong>
      <span>${plan.summary.minerai} minerai | ${plan.summary.credits} credits</span>
    </div>
    <div class="economy-chip">
      <strong>Production</strong>
      <span>${plan.summary.shipSlotsUsed}/${plan.summary.shipSlotCapacity} slots vaisseaux</span>
    </div>
    <div class="economy-chip">
      <strong>Depot</strong>
      <span>${plan.hubs[0] ? `${plan.hubs[0].nom} ${formatCoord(plan.hubs[0].coord_x, plan.hubs[0].coord_y)}` : "Aucun hub"}</span>
    </div>
    <div class="economy-chip">
      <strong>Objectif</strong>
      <span>${plan.visibleTargets[0] ? `${plan.visibleTargets[0].nom} ${formatCoord(plan.visibleTargets[0].coord_x, plan.visibleTargets[0].coord_y)}` : "Aucune cible"}</span>
    </div>
  `;

  if (!plan.recommendations.length) {
    elements.economyList.classList.add("empty-state");
    elements.economyList.innerHTML = "<li>Aucune recommandation pour l'instant.</li>";
    return;
  }

  elements.economyList.innerHTML = plan.recommendations
    .map((recommendation) => {
      return `
        <li>
          <strong>${recommendation.title}</strong>
          <span>${recommendation.detail}</span>
          <br />
          <span>${recommendation.why}</span>
        </li>
      `;
    })
    .join("");
}

function renderTargets() {
  const planets = [...state.cells.values()]
    .filter((cell) => cell.planete && !isEmptySector(cell))
    .sort((a, b) => getPlanetMinerals(b) - getPlanetMinerals(a))
    .slice(0, 6);

  elements.targetsList.classList.remove("empty-state");

  if (!planets.length) {
    elements.targetsList.classList.add("empty-state");
    elements.targetsList.innerHTML = "<li>Aucune planete visible.</li>";
    return;
  }

  elements.targetsList.innerHTML = planets
    .map((cell) => {
      const ownerLabel = hasOwner(cell)
        ? `Controlee par ${cell.proprietaire.nom || "une equipe"}`
        : "Libre";

      return `
        <li>
          <strong>${cell.planete.nom}</strong>
          <span>${formatCoord(cell.coord_x, cell.coord_y)} | ${cell.planete.mineraiDisponible} minerai</span>
          <br />
          <span>${ownerLabel}</span>
        </li>
      `;
    })
    .join("");
}

function updateMetrics() {
  const cells = [...state.cells.values()];
  const planets = cells.filter((cell) => cell.planete && !isEmptySector(cell));
  const richPlanets = planets.filter(isRichPlanet);

  elements.knownCount.textContent = String(cells.length);
  elements.planetCount.textContent = String(planets.length);
  elements.richCount.textContent = String(richPlanets.length);
  elements.shipCount.textContent = String(state.ships.length);
  elements.rangeLabel.textContent = `x:${state.range.x.join("-")} y:${state.range.y.join("-")}`;
}

function renderTooltipContent(cell, ships) {
  const planet = cell?.planete;
  const owner = cell?.proprietaire?.nom || "Aucun";
  const x = Number(cell?.coord_x ?? ships?.[0]?.coord_x ?? 0);
  const y = Number(cell?.coord_y ?? ships?.[0]?.coord_y ?? 0);
  const lines = [`<h3>Case ${formatCoord(x, y)}</h3>`];

  if (planet && !isEmptySector(cell)) {
    lines.push(`<p><strong>${planet.nom}</strong></p>`);
    lines.push(`<p>Minerai : <strong>${planet.mineraiDisponible}</strong></p>`);
    lines.push(`<p>PV : <strong>${planet.pointDeVie}</strong></p>`);
    lines.push(`<p>Slots : <strong>${planet.slotsConstruction}</strong></p>`);
    if (planet.biome || planet.typePlanete) {
      lines.push(
        `<p>${planet.biome || "Biome ?"} | ${planet.typePlanete || "Type ?"}</p>`
      );
    }
  } else if (isEmptySector(cell)) {
    lines.push("<p>Secteur vide repere.</p>");
  } else if (cell) {
    lines.push("<p>Case connue sans planete.</p>");
  } else {
    lines.push("<p>Case inconnue.</p>");
  }

  if (cell) {
    lines.push(`<p>Proprietaire : <strong>${owner}</strong></p>`);
  }

  if (ships.length) {
    lines.push(
      `<p>Vaisseaux allies : <strong>${ships.map((ship) => ship.nom).join(", ")}</strong></p>`
    );
  }

  return lines.join("");
}

function placeTooltip(event, html) {
  elements.tooltip.hidden = false;
  elements.tooltip.innerHTML = html;

  const viewportRect = elements.mapViewport.getBoundingClientRect();
  const tooltipRect = elements.tooltip.getBoundingClientRect();
  const offset = 16;
  const maxLeft = viewportRect.width - tooltipRect.width - 10;
  const maxTop = viewportRect.height - tooltipRect.height - 10;
  const left = clamp(event.clientX - viewportRect.left + offset, 8, maxLeft);
  const top = clamp(event.clientY - viewportRect.top + offset, 8, maxTop);

  elements.tooltip.style.left = `${left}px`;
  elements.tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  elements.tooltip.hidden = true;
}

function computeFleetBounds() {
  if (!state.ships.length) {
    return null;
  }

  const xs = state.ships.map((ship) => ship.coord_x);
  const ys = state.ships.map((ship) => ship.coord_y);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

function centerOnCell(x, y) {
  const cellSize = BASE_CELL_SIZE * state.zoom;
  const gap = 2;
  const unit = cellSize + gap;

  elements.mapViewport.scrollTo({
    left: Math.max(0, x * unit - elements.mapViewport.clientWidth / 2 + cellSize / 2),
    top: Math.max(0, y * unit - elements.mapViewport.clientHeight / 2 + cellSize / 2),
    behavior: state.firstRenderDone ? "smooth" : "auto"
  });
}

function fitToFleet() {
  const bounds = computeFleetBounds();

  if (!bounds) {
    return;
  }

  const padding = 4;
  const widthInCells = bounds.maxX - bounds.minX + 1 + padding * 2;
  const heightInCells = bounds.maxY - bounds.minY + 1 + padding * 2;
  const availableWidth = elements.mapViewport.clientWidth - 36;
  const availableHeight = elements.mapViewport.clientHeight - 36;
  const zoomX = availableWidth / (widthInCells * BASE_CELL_SIZE);
  const zoomY = availableHeight / (heightInCells * BASE_CELL_SIZE);
  const nextZoom = clamp(Math.min(zoomX, zoomY, 2.2), 0.9, 2.2);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  setZoom(nextZoom);

  requestAnimationFrame(() => {
    centerOnCell(centerX, centerY);
  });
}

function applyState(payload) {
  state.ships = Array.isArray(payload.ships) ? payload.ships : [];
  state.economyPlan = payload.economyPlan ?? null;
  state.range = payload.range ?? state.range;
  state.cells = new Map();

  for (const cell of payload.cells ?? []) {
    state.cells.set(keyFor(cell.coord_x, cell.coord_y), cell);
  }

  renderMap();
  renderFleet();
  renderEconomyPlan(state.economyPlan);
  renderTargets();
  updateMetrics();

  elements.lastUpdate.textContent = `Derniere mise a jour : ${new Date(payload.fetchedAt).toLocaleTimeString("fr-FR")}`;
  elements.statusText.textContent = `${state.cells.size} cases chargees, ${state.ships.length} vaisseaux suivis.`;

  if (state.followShips || !state.firstRenderDone) {
    fitToFleet();
  }

  state.firstRenderDone = true;
}

async function refreshLeaderboard() {
  if (state.unauthorized) {
    return;
  }

  try {
    const response = await fetch("/api/leaderboard", {
      headers: {
        Accept: "application/json"
      }
    });
    const payload = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        setUnauthorizedState(
          "Token expire ou invalide. Remplace TOKEN dans .env puis redemarre le serveur."
        );
      }
      throw new Error(payload.error || "Classement indisponible");
    }

    state.leaderboard = Array.isArray(payload.leaderboard)
      ? payload.leaderboard
      : [];
    state.unauthorized = false;
    renderLeaderboard(state.leaderboard);
  } catch (error) {
    renderLeaderboard([], error.message);
  }
}

async function refreshState() {
  if (state.unauthorized) {
    return;
  }

  elements.statusText.textContent = "Rafraichissement de la carte...";

  try {
    const response = await fetch("/api/state", {
      headers: {
        Accept: "application/json"
      }
    });

    const payload = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        setUnauthorizedState(
          "Token expire ou invalide. Remplace TOKEN dans .env puis redemarre le serveur."
        );
      }
      throw new Error(payload.error || "Erreur API");
    }

    applyState(payload);
  } catch (error) {
    elements.statusText.textContent = error.message;
  }
}

async function refreshDashboard() {
  if (state.unauthorized) {
    return;
  }

  await Promise.allSettled([refreshState(), refreshLeaderboard()]);
}

function updateRefreshTimer() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  const delay = Number(elements.refreshSelect.value);

  if (delay > 0) {
    state.refreshTimer = window.setInterval(refreshDashboard, delay);
  }
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", refreshDashboard);
  elements.refreshSelect.addEventListener("change", updateRefreshTimer);
  elements.followShipsToggle.addEventListener("change", (event) => {
    state.followShips = event.target.checked;
    if (state.followShips) {
      fitToFleet();
    }
  });
  elements.zoomOutButton.addEventListener("click", () => setZoom(state.zoom - 0.15));
  elements.zoomInButton.addEventListener("click", () => setZoom(state.zoom + 0.15));
  elements.fitButton.addEventListener("click", fitToFleet);

  elements.mapViewport.addEventListener("pointermove", (event) => {
    const cellElement = event.target.closest(".cell");

    if (!cellElement) {
      hideTooltip();
      return;
    }

    const x = Number(cellElement.dataset.x);
    const y = Number(cellElement.dataset.y);
    const key = keyFor(x, y);
    const cell = state.cells.get(key);
    const ships = state.ships.filter(
      (ship) => ship.coord_x === x && ship.coord_y === y
    );

    if (!cell && !ships.length) {
      hideTooltip();
      return;
    }

    placeTooltip(event, renderTooltipContent(cell, ships));
  });

  elements.mapViewport.addEventListener("pointerleave", hideTooltip);
}

buildGrid();
bindEvents();
setZoom(1);
updateRefreshTimer();
renderEconomyPlan(null, "Chargement...");
renderLeaderboard([], "Chargement...");
refreshDashboard();
